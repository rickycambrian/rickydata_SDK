#!/usr/bin/env python3
import argparse
import json
import os
import sys
import tempfile
import time
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
        raise SystemExit(f"Secret map not found: {map_path}")

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

    out: Dict[str, str] = {}
    for raw_key, raw_value in source.items():
        if not isinstance(raw_value, str):
            continue
        key = _normalize_key(str(raw_key))
        value = raw_value.strip()
        if not key or not value:
            continue
        if value.startswith("replace-with-your-") or value.startswith("0xreplace-with-your-"):
            continue
        out[key] = value

    return out


def _iter_target_files(claude_dir: Path, targets: List[str]) -> Iterable[Path]:
    for t in targets:
        p = claude_dir / t
        if p.is_file():
            yield p
            continue
        if p.is_dir():
            for root, _dirs, files in os.walk(p):
                for name in files:
                    yield Path(root) / name


def _is_probably_binary(data: bytes) -> bool:
    # Quick heuristic: skip files containing NUL bytes.
    return b"\x00" in data


def _apply_replacements_bytes(data: bytes, entries: List[Tuple[str, str]]) -> Tuple[bytes, Dict[str, int]]:
    # Sort by secret length desc to reduce partial replacement issues.
    sorted_entries = sorted(entries, key=lambda kv: len(kv[1]), reverse=True)

    counts: Dict[str, int] = {}
    out = data
    for key, secret in sorted_entries:
        if not secret:
            continue
        secret_b = secret.encode("utf-8", errors="strict")
        if not secret_b:
            continue
        c = out.count(secret_b)
        if c <= 0:
            continue
        placeholder_b = f"<{key}>".encode("utf-8")
        out = out.replace(secret_b, placeholder_b)
        counts[key] = counts.get(key, 0) + c
    return out, counts


def _atomic_write(path: Path, data: bytes, mode: int) -> None:
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, dir=str(path.parent)) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(data)
            tmp.flush()
            os.fsync(tmp.fileno())

        os.chmod(tmp_path, mode)
        os.replace(tmp_path, path)
    finally:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass


def _backup_file(src: Path, backup_root: Path, claude_root: Path) -> None:
    rel = src.relative_to(claude_root)
    dst = backup_root / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    # copy2 preserves mtime; permissions are good enough for recovery.
    import shutil

    shutil.copy2(src, dst)


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Scrub mapped secret values from Claude Code local storage (~/.claude) by replacing them with <PLACEHOLDER> tokens."
    )
    parser.add_argument(
        "--map-file",
        default=".git-secrets-map.local.json",
        help="Secret map file (default: .git-secrets-map.local.json).",
    )
    parser.add_argument(
        "--claude-dir",
        default=str(Path.home() / ".claude"),
        help="Claude storage directory (default: ~/.claude).",
    )
    parser.add_argument(
        "--targets",
        default="projects,teams,plans,debug,file-history,history.jsonl",
        help="Comma-separated list of subpaths under --claude-dir to scan (default: projects,teams,plans,debug,file-history,history.jsonl).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually rewrite files. Without this flag, the command runs in dry-run mode.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Disable backups (not recommended).",
    )
    parser.add_argument(
        "--backup-dir",
        default="",
        help="Backup directory. Defaults to <claude-dir>/backup-agentic-secrets-<timestamp> when --apply is used.",
    )
    parser.add_argument(
        "--max-file-bytes",
        type=int,
        default=50 * 1024 * 1024,
        help="Skip files larger than this size (default: 50MB).",
    )
    parser.add_argument(
        "--max-files",
        type=int,
        default=0,
        help="Optional cap on number of files scanned (0 = no limit).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print files that would change / were changed (never prints secret values).",
    )

    args = parser.parse_args(argv[1:])

    map_path = Path(args.map_file).expanduser().resolve()
    claude_dir = Path(args.claude_dir).expanduser().resolve()
    targets = [t.strip() for t in str(args.targets).split(",") if t.strip()]

    secret_map = _load_secret_map(map_path)
    entries = list(secret_map.items())
    if not entries:
        print("No valid secrets found in map file (nothing to scrub).", file=sys.stderr)
        return 0

    if not claude_dir.exists() or not claude_dir.is_dir():
        print(f"Claude directory not found: {claude_dir}", file=sys.stderr)
        return 2

    backup_root = None
    if args.apply and not args.no_backup:
        if args.backup_dir:
            backup_root = Path(args.backup_dir).expanduser().resolve()
        else:
            ts = time.strftime("%Y%m%d-%H%M%S")
            backup_root = claude_dir / f"backup-agentic-secrets-{ts}"
        backup_root.mkdir(parents=True, exist_ok=True)

    scanned = 0
    changed_files = 0
    total_hits_by_key: Dict[str, int] = {}

    for path in _iter_target_files(claude_dir, targets):
        if args.max_files and scanned >= args.max_files:
            break
        if not path.is_file():
            continue

        try:
            size = path.stat().st_size
        except Exception:
            continue

        if size > args.max_file_bytes:
            continue

        try:
            data = path.read_bytes()
        except Exception:
            continue

        scanned += 1

        if _is_probably_binary(data):
            continue

        out, counts = _apply_replacements_bytes(data, entries)
        if out == data:
            continue

        changed_files += 1
        for k, c in counts.items():
            total_hits_by_key[k] = total_hits_by_key.get(k, 0) + c

        if not args.apply:
            # Dry run: do not modify.
            if args.verbose:
                keys = ", ".join(sorted(counts.keys()))
                print(f"Would scrub: {path} ({keys})", file=sys.stderr)
            continue

        try:
            mode = path.stat().st_mode & 0o777
        except Exception:
            mode = 0o600

        if backup_root is not None:
            try:
                _backup_file(path, backup_root, claude_dir)
            except Exception as exc:
                print(f"Backup failed for {path}: {exc}", file=sys.stderr)
                return 2

        try:
            _atomic_write(path, out, mode)
        except Exception as exc:
            print(f"Write failed for {path}: {exc}", file=sys.stderr)
            return 2
        if args.verbose:
            keys = ", ".join(sorted(counts.keys()))
            print(f"Scrubbed: {path} ({keys})", file=sys.stderr)

    if args.apply:
        print(f"Scrub complete. Files scanned: {scanned}. Files changed: {changed_files}.", file=sys.stderr)
        if backup_root is not None:
            print(f"Backup saved under: {backup_root}", file=sys.stderr)
    else:
        print(f"Dry run complete. Files scanned: {scanned}. Files that would change: {changed_files}.", file=sys.stderr)

    # Do not print secret values; only keys and counts.
    if total_hits_by_key:
        print("Replacements (by key):", file=sys.stderr)
        for key in sorted(total_hits_by_key.keys()):
            print(f"- {key}: {total_hits_by_key[key]}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
