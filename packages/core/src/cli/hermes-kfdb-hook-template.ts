export const HERMES_KFDB_TRACE_HOOK_YAML = `name: rickydata-kfdb-trace
description: Write Hermes gateway session/turn trace events to Ricky's private KFDB tenant using the local wallet-derived session.
events:
  - gateway:startup
  - session:start
  - agent:start
  - agent:step
  - agent:end
  - session:end
  - session:reset
`;

export const HERMES_KFDB_TRACE_HANDLER = `from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HOOK_DIR = Path(__file__).resolve().parent
STATE_DIR = HOOK_DIR / "state"
STATE_DIR.mkdir(parents=True, exist_ok=True)
LOG_PATH = STATE_DIR / "events.jsonl"
SESSION_STATE_PATH = STATE_DIR / "sessions.json"
ENV_PATHS = [Path.home() / ".hermes" / ".env", Path.home() / ".env"]

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9_]{20,}"),
    re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"),
    re.compile(r"(?i)(api[_-]?key|token|secret|password|private[_-]?key)\\s*[:=]\\s*['\\"]?[^\\s'\\"]+"),
]
MAX_TEXT = 4000


def _load_dotenv() -> None:
    for path in ENV_PATHS:
        if not path.exists():
            continue
        try:
            for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[7:].strip()
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        except Exception:
            pass


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if re.search(r"(?i)(api[_-]?key|token|secret|password|private[_-]?key|derive[_-]?key)", str(k)):
                out[str(k)] = "[REDACTED]"
            else:
                out[str(k)] = _redact(v)
        return out
    if isinstance(value, list):
        return [_redact(v) for v in value[:50]]
    if isinstance(value, str):
        text = value[:MAX_TEXT]
        for pat in SECRET_PATTERNS:
            text = pat.sub(lambda m: m.group(0).split("=", 1)[0] + "=[REDACTED]" if "=" in m.group(0) else "[REDACTED]", text)
        return text
    return value


def _env(name: str, *fallbacks: str) -> str:
    for key in (name, *fallbacks):
        value = os.environ.get(key)
        if value:
            return value
    return ""


def _config() -> dict[str, str]:
    _load_dotenv()
    url = _env("RICKYDATA_KFDB_URL", "KFDB_API_URL", "KFDB_URL").rstrip("/")
    return {
        "url": url,
        "api_key": _env("RICKYDATA_KFDB_API_KEY", "KFDB_API_KEY", "RICKYDATA_KFDB_BEARER_TOKEN"),
        "wallet": _env("RICKYDATA_KFDB_WALLET_ADDRESS", "OPERATOR_WALLET_ADDRESS", "TEST_WALLET_ADDRESS").lower(),
        "derive_session_id": _env("RICKYDATA_KFDB_DERIVE_SESSION_ID"),
        "derive_key": _env("RICKYDATA_KFDB_DERIVE_KEY"),
    }


def _ready(cfg: dict[str, str]) -> bool:
    return all(cfg.get(k) for k in ("url", "api_key", "wallet", "derive_session_id", "derive_key"))


def _headers(cfg: dict[str, str]) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg['api_key']}",
        "X-Wallet-Address": cfg["wallet"],
        "X-Derive-Session-Id": cfg["derive_session_id"],
        "X-Derive-Key": cfg["derive_key"],
    }


def _post(cfg: dict[str, str], path: str, payload: dict[str, Any]) -> bool:
    data = json.dumps(_redact(payload), ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(f"{cfg['url']}{path}", data=data, headers=_headers(cfg), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            ok = 200 <= resp.status < 300
            return ok
    except urllib.error.HTTPError as exc:
        _log({"kind": "http_error", "path": path, "status": exc.code, "body": exc.read(300).decode("utf-8", "ignore")})
    except Exception as exc:
        _log({"kind": "post_error", "path": path, "error": str(exc)[:300]})
    return False


def _log(record: dict[str, Any]) -> None:
    safe = _redact({"ts": time.time(), **record})
    try:
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(safe, ensure_ascii=False) + "\\n")
    except Exception:
        pass


def _load_state() -> dict[str, Any]:
    try:
        return json.loads(SESSION_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_state(state: dict[str, Any]) -> None:
    try:
        SESSION_STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\\n", encoding="utf-8")
    except Exception:
        pass


def _sid(context: dict[str, Any]) -> str:
    return str(context.get("session_id") or context.get("session_key") or "hermes-local")


def _workspace(context: dict[str, Any]) -> str:
    return str(context.get("platform") or "hermes")


def _agent_session_id(session_id: str) -> str:
    # Keep Hermes session identity readable while avoiding illegal chars in downstream systems.
    return f"hermes:{session_id}"


def _ensure_session(cfg: dict[str, str], context: dict[str, Any]) -> bool:
    session_id = _agent_session_id(_sid(context))
    metadata = {
        "source": "hermes-hooks",
        "platform": context.get("platform"),
        "chat_id": context.get("chat_id"),
        "user_id_hash": hashlib.sha256(str(context.get("user_id", "")).encode()).hexdigest()[:16],
        "privacy_scope": "private",
        "schema_version": 1,
    }
    return _post(cfg, "/api/v1/plugin/ensure-session", {
        "session_id": session_id,
        "workspace_name": _workspace(context),
        "working_directory": str(Path.cwd()),
        "provider": "hermes",
        "transcript_path": None,
        "metadata": metadata,
    })


def _track_message(cfg: dict[str, str], context: dict[str, Any], message_type: str, content: str, extra: dict[str, Any] | None = None) -> bool:
    if not content:
        return True
    session_id = _agent_session_id(_sid(context))
    return _post(cfg, "/api/v1/plugin/track-message", {
        "session_id": session_id,
        "message_type": message_type,
        "workspace_name": _workspace(context),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "content": content,
        "metadata": {
            "source": "hermes-hooks",
            "event_type": extra.get("event_type") if extra else None,
            "turn_index": extra.get("turn_index") if extra else None,
            "privacy_scope": "private",
        },
    })


def _track_tool(cfg: dict[str, str], context: dict[str, Any], tool: Any, idx: int) -> bool:
    session_id = _agent_session_id(_sid(context))
    tool_name = tool.get("name") if isinstance(tool, dict) else str(tool)
    return _post(cfg, "/api/v1/plugin/track-tool-call", {
        "session_id": session_id,
        "tool_name": tool_name or "unknown",
        "workspace_name": _workspace(context),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "input_summary": json.dumps(_redact(tool), ensure_ascii=False)[:1000] if isinstance(tool, dict) else None,
        "output_summary": None,
        "metadata": {
            "source": "hermes-hooks",
            "event_type": "agent:step",
            "iteration": context.get("iteration"),
            "sequence": idx,
            "privacy_scope": "private",
        },
    })


def _end_session(cfg: dict[str, str], context: dict[str, Any], success: bool = True) -> bool:
    session_id = _agent_session_id(_sid(context))
    response = str(context.get("response") or "")
    return _post(cfg, "/api/v1/plugin/session-end", {
        "session_id": session_id,
        "ended_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "message_count": 0,
        "tool_call_count": 0,
        "outcome_summary": response[:1000] if response else "Hermes session turn completed",
        "success": success,
        "metadata": {
            "source": "hermes-hooks",
            "privacy_scope": "private",
        },
    })


async def handle(event_type: str, context: dict[str, Any] | None = None) -> None:
    context = context or {}
    cfg = _config()
    if not _ready(cfg):
        _log({"kind": "not_ready", "event_type": event_type, "missing": [k for k, v in cfg.items() if not v and k != "api_key"]})
        return

    state = _load_state()
    sid = _sid(context)
    session_state = state.setdefault(sid, {"turns": 0, "tools": 0, "started_at": time.time()})

    ok = True
    if event_type in {"gateway:startup", "session:start"}:
        _log({"kind": "seen", "event_type": event_type, "session_id": sid})
        if event_type == "session:start":
            ok = _ensure_session(cfg, context)
    elif event_type == "agent:start":
        session_state["turns"] = int(session_state.get("turns", 0)) + 1
        ok = _ensure_session(cfg, context)
        ok = _track_message(cfg, context, "user_prompt", str(context.get("message") or ""), {"event_type": event_type, "turn_index": session_state["turns"]}) and ok
    elif event_type == "agent:step":
        ok = _ensure_session(cfg, context)
        for idx, tool in enumerate(context.get("tools") or context.get("tool_names") or []):
            session_state["tools"] = int(session_state.get("tools", 0)) + 1
            ok = _track_tool(cfg, context, tool, idx) and ok
    elif event_type == "agent:end":
        ok = _ensure_session(cfg, context)
        ok = _track_message(cfg, context, "assistant_response", str(context.get("response") or ""), {"event_type": event_type, "turn_index": session_state.get("turns")}) and ok
        ok = _end_session(cfg, context, success=True) and ok
    elif event_type in {"session:end", "session:reset"}:
        ok = _end_session(cfg, context, success=True)
        if event_type == "session:reset":
            state.pop(sid, None)

    _save_state(state)
    _log({"kind": "handled", "event_type": event_type, "session_id": sid, "ok": ok})
`;
