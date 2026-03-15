#!/usr/bin/env python3
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple


def _run_git(args: List[str]) -> str:
    return subprocess.check_output(["git", *args], text=True, stderr=subprocess.STDOUT)


def _parse_mode(argv: List[str]) -> Tuple[str, Optional[str]]:
    if "--staged" in argv:
        return ("staged", None)

    if "--range" in argv:
        idx = argv.index("--range")
        if idx + 1 < len(argv):
            return ("range", argv[idx + 1])

    return ("staged", None)


def _get_diff(mode: str, value: Optional[str]) -> str:
    if mode == "staged":
        return _run_git(["diff", "--cached", "--unified=0", "--no-color"])
    return _run_git(["diff", "--unified=0", "--no-color", value or "HEAD"])


def _should_skip_file(file_path: str) -> bool:
    if not file_path:
        return True
    if file_path.startswith(".git/"):
        return True
    if "/node_modules/" in file_path or file_path.startswith("node_modules/"):
        return True
    if "/dist/" in file_path or file_path.startswith("dist/"):
        return True
    if "/build/" in file_path or file_path.startswith("build/"):
        return True
    # Skip the secret-guard tooling itself (variable names like secret_map trigger false positives).
    _self_scripts = {"scripts/secret-guard.py", "scripts/secret-filter.py", "scripts/scrub-claude-home.py"}
    if file_path in _self_scripts:
        return True
    return False


def _normalize_value(raw: str) -> str:
    v = raw.strip()
    if len(v) >= 2 and v[0] in {"'", '"', "`"} and v[-1] == v[0]:
        v = v[1:-1]
    return v.strip()


def _is_likely_placeholder(value: str) -> bool:
    v = _normalize_value(value)
    if not v:
        return True

    if v.startswith("<") and v.endswith(">"):
        return True
    if v.startswith("$") or "${" in v:
        return True
    if v == "0x..." or "..." in v:
        return True

    lower = v.lower()
    if "example" in lower or "placeholder" in lower or "changeme" in lower:
        return True
    if lower.startswith("replace-with-") or lower.startswith("your_"):
        return True
    if "process.env" in lower or "import.meta.env" in lower:
        return True
    if lower.startswith("http://") or lower.startswith("https://"):
        return True
    if "localhost" in lower:
        return True
    if "mock" in lower or "dummy" in lower:
        return True
    if lower.startswith("test-") or lower.startswith("test_"):
        return True
    # Code expressions (method calls, function calls) are never literal secrets
    if "(" in v or ")" in v:
        return True

    return False


def _looks_like_real_secret(value: str) -> bool:
    v = _normalize_value(value)
    if _is_likely_placeholder(v):
        return False
    if len(v) < 20:
        return False
    if not re.search(r"[A-Za-z]", v):
        return False
    # Many real tokens are mixed-format but may not contain digits; require *some* non-letter
    # character to reduce false positives on long plain words while still catching common
    # token formats (sk-..., ghp_..., base64-ish strings, etc).
    if not re.search(r"[^A-Za-z]", v):
        return False
    return True


@dataclass(frozen=True)
class Finding:
    file_path: str
    line_no: int
    kind: str


def _find_line_issues(file_path: str, line_no: int, line: str) -> Iterable[Finding]:
    findings: List[Finding] = []

    private_key_re = re.compile(r"(?:PRIVATE_KEY|privateKey|WALLET_KEY|walletKey)\s*[:=]\s*['\"]?(0x[a-fA-F0-9]{64})['\"]?")
    for match in private_key_re.finditer(line):
        value = match.group(1)
        if _is_likely_placeholder(value):
            continue
        findings.append(Finding(file_path=file_path, line_no=line_no, kind="private-key-literal"))

    bearer_re = re.compile(r"Authorization[^\n]*Bearer\s+([A-Za-z0-9._-]{20,})")
    for match in bearer_re.finditer(line):
        value = match.group(1)
        if not _looks_like_real_secret(value):
            continue
        findings.append(Finding(file_path=file_path, line_no=line_no, kind="bearer-literal"))

    sensitive_assign_re = re.compile(
        r"(?:^|\s)(?:export\s+)?['\"]?((?:[A-Za-z_][A-Za-z0-9_]*)?(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|apiKey|token|secret|password|privateKey|accessKey)[A-Za-z0-9_]*)['\"]?\s*[:=]\s*(['\"`]?)([^'\"`\s]+)\2"
    )
    for match in sensitive_assign_re.finditer(line):
        name = match.group(1)
        value = match.group(3)
        if not _looks_like_real_secret(value):
            continue
        findings.append(Finding(file_path=file_path, line_no=line_no, kind=f"sensitive-assignment:{name}"))

    return findings


def _parse_added_lines(diff_text: str) -> List[Finding]:
    findings: List[Finding] = []
    file_path = ""
    new_line_no = 0

    for raw_line in diff_text.splitlines():
        line = raw_line

        if line.startswith("+++ b/"):
            file_path = line[len("+++ b/") :]
            continue

        if line.startswith("@@"):
            hunk_match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if hunk_match:
                new_line_no = int(hunk_match.group(1)) - 1
            continue

        if not file_path or _should_skip_file(file_path):
            continue

        if line.startswith("+") and not line.startswith("+++"):
            new_line_no += 1
            added = line[1:]
            findings.extend(_find_line_issues(file_path, new_line_no, added))
            continue

        if line.startswith(" ") or line.startswith("\\"):
            new_line_no += 1

    # Dedup.
    dedup = {(f.file_path, f.line_no, f.kind): f for f in findings}
    return list(dedup.values())


def main(argv: List[str]) -> int:
    mode, value = _parse_mode(argv)

    try:
        diff_text = _get_diff(mode, value)
    except subprocess.CalledProcessError as exc:
        print("Secret guard failed to read git diff output.", file=sys.stderr)
        print(exc.output, file=sys.stderr)
        return 2

    findings = _parse_added_lines(diff_text)
    if not findings:
        return 0

    print("Secret guard blocked this change: secret-like literal values detected in added lines.", file=sys.stderr)
    for f in sorted(findings, key=lambda x: (x.file_path, x.line_no, x.kind)):
        print(f"- {f.file_path}:{f.line_no} [{f.kind}]", file=sys.stderr)
    print("Use placeholders in tracked files (example: <OPENAI_API_KEY>) and keep real values in .git-secrets-map.local.json.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
