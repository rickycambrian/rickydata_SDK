#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


def _normalize_key(key: str) -> str:
    k = key.strip()
    if k.startswith("<"):
        k = k[1:]
    if k.endswith(">"):
        k = k[:-1]
    return k.strip()


def _load_secret_map(map_path: Path) -> Dict[str, str]:
    if not map_path.exists():
        return {}

    try:
        parsed = json.loads(map_path.read_text("utf-8"))
    except Exception as exc:
        raise SystemExit(f"Invalid JSON in {map_path}: {exc}") from exc

    source = (
        parsed.get("secrets")
        if isinstance(parsed, dict) and isinstance(parsed.get("secrets"), dict)
        else parsed
    )

    if not isinstance(source, dict):
        return {}

    normalized: Dict[str, str] = {}
    for raw_key, raw_value in source.items():
        if not isinstance(raw_value, str):
            continue
        key = _normalize_key(str(raw_key))
        value = raw_value.strip()
        if not key or not value:
            continue
        if value.startswith("replace-with-your-") or value.startswith("0xreplace-with-your-"):
            continue
        normalized[key] = value

    return normalized


def _apply_replacements(content: str, entries: Iterable[Tuple[str, str]], mode: str) -> str:
    # Sort by value length (desc) to reduce accidental partial replacements.
    sorted_entries: List[Tuple[str, str]] = sorted(entries, key=lambda kv: len(kv[1]), reverse=True)
    out = content
    for key, value in sorted_entries:
        if not value:
            continue
        placeholder = f"<{key}>"
        if mode == "clean":
            out = out.replace(value, placeholder)
        else:
            out = out.replace(placeholder, value)
    return out


def main(argv: List[str]) -> int:
    if len(argv) < 2 or argv[1] not in {"clean", "smudge"}:
        print("Usage: scripts/secret-filter.py <clean|smudge>", file=sys.stderr)
        return 2

    mode = argv[1]
    repo_root = Path(__file__).resolve().parent.parent
    map_path = Path(os.environ.get("GIT_SECRETS_MAP", str(repo_root / ".git-secrets-map.local.json")))

    input_text = sys.stdin.read()
    secret_map = _load_secret_map(map_path)
    if not secret_map:
        sys.stdout.write(input_text)
        return 0

    output_text = _apply_replacements(input_text, secret_map.items(), mode)
    sys.stdout.write(output_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
