export const HERMES_KFDB_TRACE_HOOK_YAML = `name: rickydata-kfdb-trace
description: Write Hermes gateway/session/agent/command hook events into Ricky's private KFDB tenant as connected HermesSession/HermesTurn/HermesHookEvent graph data.
events:
  - gateway:startup
  - session:start
  - agent:start
  - agent:step
  - agent:end
  - session:end
  - session:reset
  - command:*
`;

export const HERMES_KFDB_TRACE_HANDLER = `from __future__ import annotations

import hashlib
import json
import os
import re
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HOOK_DIR = Path(__file__).resolve().parent
STATE_DIR = HOOK_DIR / "state"
EVENT_LOG = STATE_DIR / "events.jsonl"
STATE_FILE = STATE_DIR / "sessions.json"
DNS_NAMESPACE = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
KG_NAMESPACE = uuid.uuid5(DNS_NAMESPACE, "rickydata-hermes-hook-knowledge-graph-v1")
EXECUTION_KG_NAMESPACE = uuid.uuid5(DNS_NAMESPACE, "rickydata-execution-knowledge-graph-v1")
TRACE_SCHEMA_VERSION = 3
SECRET_PATTERNS = [
    re.compile(r"(authorization|api[_-]?key|token|secret|password|private[_-]?key|derive[_-]?key|cookie)\\s*[:=]\\s*[^\\s,}\\]]+", re.I),
    re.compile(r"Bearer\\s+[A-Za-z0-9._~+/=-]+", re.I),
    re.compile(r"eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
]


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _redact_string(value: str) -> str:
    text = value
    for pattern in SECRET_PATTERNS:
        text = pattern.sub(lambda m: m.group(0).split("=", 1)[0].split(":", 1)[0] + "=[REDACTED]", text)
    return text if len(text) <= 4000 else text[:4000] + "…[truncated]"


def _safe(obj: Any) -> Any:
    if isinstance(obj, str):
        return _redact_string(obj)
    if isinstance(obj, (int, float, bool)) or obj is None:
        return obj
    if isinstance(obj, list):
        return [_safe(item) for item in obj[:100]]
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for key, value in list(obj.items())[:200]:
            if re.search(r"api[_-]?key|token|secret|password|private[_-]?key|derive[_-]?key|authorization|cookie", str(key), re.I):
                out[str(key)] = "[REDACTED]"
            else:
                out[str(key)] = _safe(value)
        return out
    return _redact_string(str(obj))


def _hash(value: Any) -> str:
    if isinstance(value, str):
        data = value
    else:
        data = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(data.encode()).hexdigest()


def _id(kind: str, parts: list[Any]) -> str:
    return str(uuid.uuid5(KG_NAMESPACE, f"{kind}:" + ":".join(str(p) for p in parts)))


def _exec_id(kind: str, parts: list[Any]) -> str:
    return str(uuid.uuid5(EXECUTION_KG_NAMESPACE, f"{kind}:" + ":".join(str(p) for p in parts)))


def _value(input_value: Any) -> dict[str, Any]:
    if input_value is None:
        return {"Null": None}
    if isinstance(input_value, bool):
        return {"Boolean": input_value}
    if isinstance(input_value, int):
        return {"Integer": input_value}
    if isinstance(input_value, float):
        return {"Float": input_value}
    if isinstance(input_value, list):
        return {"Array": [_value(v) for v in input_value]}
    if isinstance(input_value, dict):
        return {"Object": {str(k): _value(v) for k, v in input_value.items()}}
    return {"String": str(input_value)}


def _summarize_payload(payload: Any) -> dict[str, Any]:
    if payload is None:
        return {"value": None}
    encoded = payload if isinstance(payload, str) else json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return {"contentLength": len(encoded), "contentHash": _hash(encoded)}


def _extract_command(input_value: Any) -> str | None:
    if isinstance(input_value, str):
        return input_value
    if isinstance(input_value, dict):
        for key in ("command", "cmd", "script"):
            if isinstance(input_value.get(key), str) and input_value.get(key):
                return str(input_value[key])
    return None


def _collect_file_paths(input_value: Any, output: set[str] | None = None) -> set[str]:
    output = output or set()
    if input_value is None:
        return output
    if isinstance(input_value, str):
        for match in re.finditer(r"^\\*{3} (?:Add|Update|Delete) File: (.+)$", input_value, re.M):
            output.add(match.group(1).strip())
        return output
    if isinstance(input_value, list):
        for item in input_value:
            _collect_file_paths(item, output)
        return output
    if isinstance(input_value, dict):
        for key, item in input_value.items():
            lower = str(key).lower()
            if isinstance(item, str) and re.search(r"(^|_)(file|path|filepath|filename)$", lower) and 0 < len(item) < 1000:
                output.add(item)
            else:
                _collect_file_paths(item, output)
    return output


def _basename(path: str) -> str:
    return path.replace("\\\\", "/").rstrip("/").split("/")[-1] or path


def _extension(path: str) -> str:
    base = _basename(path)
    return base.rsplit(".", 1)[1].lower() if "." in base and not base.startswith(".") else ""


def _summarize_command(command: str) -> dict[str, Any]:
    return {"command_hash": _hash(command), "command_length": len(command), "command_preview": command.splitlines()[0][:240] if command.splitlines() else ""}


def _load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"sessions": {}, "aliases": {}, "sequence": 0}
    try:
        data = json.loads(STATE_FILE.read_text())
        if isinstance(data, dict):
            data.setdefault("sessions", {})
            data.setdefault("aliases", {})
            data.setdefault("sequence", 0)
            return data
    except Exception:
        pass
    return {"sessions": {}, "aliases": {}, "sequence": 0}


def _save_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(STATE_FILE)


def _log(record: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    record = {"ts": time.time(), **_safe(record)}
    with EVENT_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True, ensure_ascii=False) + "\\n")


def _config() -> dict[str, str | None]:
    _load_dotenv(Path.home() / ".hermes" / ".env")
    _load_dotenv(Path.home() / ".env")
    return {
        "url": _env("RICKYDATA_KFDB_URL", "KFDB_API_URL", "KFDB_URL"),
        "api_key": _env("RICKYDATA_KFDB_API_KEY", "KFDB_API_KEY", "RICKYDATA_KFDB_BEARER_TOKEN"),
        "wallet": _env("RICKYDATA_KFDB_WALLET_ADDRESS", "OPERATOR_WALLET_ADDRESS", "TEST_WALLET_ADDRESS"),
        "derive_session_id": _env("RICKYDATA_KFDB_DERIVE_SESSION_ID", "KFDB_DERIVE_SESSION_ID"),
        "derive_key": _env("RICKYDATA_KFDB_DERIVE_KEY", "KFDB_DERIVE_KEY"),
        "agent_id": _env("RICKYDATA_HERMES_AGENT_ID", "HERMES_AGENT_ID") or "agent:hermes",
        "provider": _env("HERMES_MODEL_PROVIDER"),
        "model": _env("HERMES_MODEL"),
    }


def _post_write(config: dict[str, str | None], operations: list[dict[str, Any]]) -> bool:
    missing = [k for k in ("url", "api_key", "wallet", "derive_session_id", "derive_key") if not config.get(k)]
    if missing:
        _log({"kind": "missing_config", "missing": missing})
        return False
    payload = json.dumps({"operations": operations, "skip_embedding": True}, ensure_ascii=False).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
        "X-Wallet-Address": str(config["wallet"]),
        "X-Derive-Session-Id": str(config["derive_session_id"]),
        "X-Derive-Key": str(config["derive_key"]),
    }
    request = urllib.request.Request(str(config["url"]).rstrip("/") + "/api/v1/write", data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode(errors="replace")[:1000]
            _log({"kind": "write_ok", "status": response.status, "operations": len(operations), "body": body})
            return 200 <= response.status < 300
    except urllib.error.HTTPError as exc:
        _log({"kind": "http_error", "status": exc.code, "body": exc.read().decode(errors="replace")[:2000], "operations": len(operations)})
    except Exception as exc:
        _log({"kind": "post_error", "error": str(exc), "operations": len(operations)})
    return False


def _canonical_session(event_type: str, context: dict[str, Any], state: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    native = context.get("session_id") or context.get("gateway_session_id")
    session_key = context.get("session_key")
    if not native and session_key:
        native = state.get("aliases", {}).get(str(session_key))
    if not native:
        native = context.get("chat_id") or "hermes-local"
    native = str(native)
    if session_key:
        state.setdefault("aliases", {})[str(session_key)] = native
    session = state.setdefault("sessions", {}).setdefault(native, {"turn_index": 0, "tool_count": 0, "command_count": 0})
    if event_type == "agent:start":
        session["turn_index"] = int(session.get("turn_index") or 0) + 1
        session["turn_started_at"] = int(time.time() * 1000)
    session["last_seen_at"] = int(time.time() * 1000)
    for key in ("platform", "chat_id", "user_id", "model", "provider", "cwd", "session_key"):
        if context.get(key):
            session[key] = context.get(key)
    return native, session


def _event_data(event_type: str, context: dict[str, Any], native_sid: str, session: dict[str, Any], seq: int, config: dict[str, str | None]) -> dict[str, Any]:
    now_ms = int(time.time() * 1000)
    platform = str(context.get("platform") or session.get("platform") or "")
    user_id = context.get("user_id") or session.get("user_id")
    chat_id = context.get("chat_id") or session.get("chat_id")
    model = str(context.get("model") or context.get("model_used") or session.get("model") or config.get("model") or "")
    provider = str(context.get("provider") or context.get("provider_used") or session.get("provider") or config.get("provider") or "hermes")
    message = context.get("message") if event_type == "agent:start" else None
    response = context.get("response") if event_type == "agent:end" else None
    return {
        "sequence": seq,
        "hookEventName": event_type,
        "rawEventType": event_type,
        "hermesSessionId": native_sid,
        "gatewaySessionId": context.get("session_key") or session.get("session_key") or "",
        "platform": platform,
        "chatIdHash": _hash(str(chat_id))[:16] if chat_id else "",
        "userIdHash": _hash(str(user_id))[:16] if user_id else "",
        "cwd": context.get("cwd") or session.get("cwd") or os.getcwd(),
        "model": model,
        "provider": provider,
        "receivedAt": now_ms,
        "messageRole": "user" if event_type == "agent:start" else "assistant" if event_type == "agent:end" else "command" if event_type.startswith("command:") else "system",
        "messageHash": _hash(str(message)) if isinstance(message, str) else None,
        "messageLength": len(message) if isinstance(message, str) else None,
        "responseHash": _hash(str(response)) if isinstance(response, str) else None,
        "responseLength": len(response) if isinstance(response, str) else None,
        "commandName": context.get("command") if event_type.startswith("command:") else None,
        "rawCommand": context.get("raw_command") if event_type.startswith("command:") else None,
        "commandArgs": _summarize_payload(context.get("raw_args")) if event_type.startswith("command:") else None,
        "iteration": context.get("iteration"),
        "outcomeStatus": "success" if event_type in ("agent:end", "session:end") else "observed",
        "rawContextKeys": sorted(str(k) for k in context.keys()),
    }


def _node(label: str, node_id: str, props: dict[str, Any]) -> dict[str, Any]:
    return {"operation": "create_node", "id": node_id, "label": label, "mode": "merge", "properties": {k: _value(v) for k, v in props.items()}}


def _edge(edge_type: str, from_id: str, to_id: str, props: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"operation": "create_edge", "id": _id(edge_type, [from_id, to_id]), "from": from_id, "to": to_id, "edge_type": edge_type, "properties": {k: _value(v) for k, v in (props or {}).items()}}


def _base_operations(event_type: str, context: dict[str, Any], state: dict[str, Any], config: dict[str, str | None]) -> tuple[list[dict[str, Any]], str, str, dict[str, Any], int]:
    state["sequence"] = int(state.get("sequence") or 0) + 1
    seq = int(state["sequence"])
    native_sid, session = _canonical_session(event_type, context, state)
    wallet = str(config.get("wallet") or "").lower()
    agent_id = str(config.get("agent_id") or "agent:hermes")
    turn_index = max(1, int(session.get("turn_index") or 1))
    event = _event_data(event_type, context, native_sid, session, seq, config)
    provider = event.get("provider") or "hermes"
    model = event.get("model") or ""
    session_node = _id("HermesSession", [wallet, agent_id, native_sid, native_sid])
    turn_node = _id("HermesTurn", [wallet, agent_id, native_sid, turn_index, native_sid])
    wallet_node = _exec_id("WalletTenant", [wallet])
    agent_node = _exec_id("Agent", [agent_id])
    engine_node = _exec_id("ExecutionEngine", ["hermes"])
    event_node = _id("HermesHookEvent", [turn_node, seq, event_type, context.get("tool_use_id") or ""])
    ops = [
        _node("WalletTenant", wallet_node, {"wallet_address": wallet, "schema_version": TRACE_SCHEMA_VERSION}),
        _node("Agent", agent_node, {"agent_id": agent_id, "schema_version": TRACE_SCHEMA_VERSION}),
        _node("HermesSession", session_node, {"agent_id": agent_id, "session_id": native_sid, "hermes_session_id": native_sid, "gateway_session_id": event.get("gatewaySessionId") or "", "platform": event.get("platform") or "", "chat_id_hash": event.get("chatIdHash") or "", "user_id_hash": event.get("userIdHash") or "", "wallet_address": wallet, "source": "hermes-hooks", "privacy_scope": "private", "schema_version": TRACE_SCHEMA_VERSION, "updated_at": event.get("receivedAt")}),
        _node("HermesTurn", turn_node, {"agent_id": agent_id, "session_id": native_sid, "hermes_session_id": native_sid, "turn_index": turn_index, "model": model, "provider": provider, "execution_engine": "hermes", "cwd": event.get("cwd") or "", "platform": event.get("platform") or "", "completed_at": event.get("receivedAt"), "privacy_scope": "private", "schema_version": TRACE_SCHEMA_VERSION}),
        _edge("OWNS_EXECUTION_SESSION", wallet_node, session_node, {"source": "hermes-hooks"}),
        _edge("EXECUTES_AGENT", session_node, agent_node, {"agent_id": agent_id}),
        _edge("HAS_HERMES_TURN", session_node, turn_node, {"turn_index": turn_index}),
        _node("ExecutionEngine", engine_node, {"execution_engine": "hermes", "schema_version": TRACE_SCHEMA_VERSION}),
        _edge("USES_EXECUTION_ENGINE", turn_node, engine_node, {"execution_engine": "hermes"}),
        _node("HermesHookEvent", event_node, {"event_index": seq, "event_type": event_type, "raw_event_type": event_type, "cwd": event.get("cwd") or "", "platform": event.get("platform") or "", "tool_name": "", "tool_use_id": "", "data": event, "privacy_scope": "private", "schema_version": TRACE_SCHEMA_VERSION}),
        _edge("EMITTED_HERMES_HOOK", turn_node, event_node, {"event_index": seq}),
    ]
    if model:
        model_node = _exec_id("Model", [provider, model])
        ops.append(_node("Model", model_node, {"provider": provider, "model": model, "schema_version": TRACE_SCHEMA_VERSION}))
        ops.append(_edge("USES_MODEL", turn_node, model_node, {"provider": provider, "model": model}))
    cwd = event.get("cwd")
    if cwd:
        workspace_node = _exec_id("CodeWorkspace", [cwd])
        ops.append(_node("CodeWorkspace", workspace_node, {"path": cwd, "path_hash": _hash(str(cwd)), "basename": _basename(str(cwd)), "schema_version": TRACE_SCHEMA_VERSION}))
        ops.append(_edge("RAN_IN_WORKSPACE", event_node, workspace_node, {"source": "hermes-hooks"}))
    return ops, native_sid, event_node, session, seq


def _tool_operations(turn_source: str, native_sid: str, session: dict[str, Any], seq: int, context: dict[str, Any]) -> list[dict[str, Any]]:
    tools = context.get("tools") or []
    if not isinstance(tools, list):
        tools = []
    if not tools and isinstance(context.get("tool_names"), list):
        tools = [{"name": n} for n in context["tool_names"]]
    ops: list[dict[str, Any]] = []
    for idx, tool in enumerate(tools):
        if isinstance(tool, str):
            tool = {"name": tool}
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or tool.get("toolName") or "unknown")
        tool_id = str(tool.get("id") or tool.get("toolUseId") or f"{seq}:{idx}:{name}")
        args = tool.get("arguments") if "arguments" in tool else tool.get("args")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                pass
        result = tool.get("result") if "result" in tool else tool.get("toolResponse")
        tool_node = _id("HermesToolUse", [native_sid, session.get("turn_index") or 1, tool_id, name])
        command = _extract_command(args)
        ops.append(_node("HermesToolUse", tool_node, {"tool_name": name, "tool_use_id": tool_id, "hook_event_name": "agent:step", "event_index": seq, "iteration": context.get("iteration") or 0, "tool_input": _summarize_payload(args), "tool_response": _summarize_payload(result), "command": _summarize_command(command) if command else None, "schema_version": TRACE_SCHEMA_VERSION}))
        ops.append(_edge("INVOKED_HERMES_TOOL", turn_source, tool_node, {"tool_name": name}))
        if command:
            command_node = _exec_id("CodeCommand", [_hash(command)])
            ops.append(_node("CodeCommand", command_node, {**_summarize_command(command), "schema_version": TRACE_SCHEMA_VERSION}))
            ops.append(_edge("RAN_COMMAND", tool_node, command_node, {"source": "hermes-hooks"}))
        for path in sorted(_collect_file_paths(args) | _collect_file_paths(result))[:50]:
            file_node = _exec_id("CodeFile", [path])
            ops.append(_node("CodeFile", file_node, {"path": path, "path_hash": _hash(path), "basename": _basename(path), "extension": _extension(path), "schema_version": TRACE_SCHEMA_VERSION}))
            ops.append(_edge("TOUCHED_FILE", tool_node, file_node, {"source": "hermes-hooks"}))
    return ops


async def handle(event_type: str, context: dict[str, Any]) -> None:
    context = context or {}
    config = _config()
    state = _load_state()
    ops, native_sid, event_node, session, seq = _base_operations(event_type, context, state, config)
    if event_type == "agent:step":
        ops.extend(_tool_operations(event_node, native_sid, session, seq, context))
        session["tool_count"] = int(session.get("tool_count") or 0) + len(context.get("tools") or context.get("tool_names") or [])
    if event_type.startswith("command:"):
        session["command_count"] = int(session.get("command_count") or 0) + 1
        command_text = f"{context.get('command') or event_type.removeprefix('command:')} {context.get('raw_args') or ''}".strip()
        command_node = _exec_id("CodeCommand", [_hash(command_text)])
        ops.append(_node("CodeCommand", command_node, {**_summarize_command(command_text), "schema_version": TRACE_SCHEMA_VERSION}))
        ops.append(_edge("RAN_COMMAND", event_node, command_node, {"source": "hermes-hooks"}))
    ok = _post_write(config, ops)
    _log({"kind": "handled", "event": event_type, "session_id": native_sid, "operations": len(ops), "ok": ok})
    _save_state(state)
`;
