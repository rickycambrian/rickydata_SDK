# Secret Hygiene Workflow

This repository uses a two-layer secret safety model:

1. **Local hydration** for fast development (agents can read real values).
2. **Commit/CI guards** to prevent literal secret leaks into Git history.

## 1) Local Hydration Setup

Run once per clone:

```bash
./scripts/setup-secret-scrub.sh
```

Then edit your ignored local map:

```bash
$EDITOR .git-secrets-map.local.json
```

Expected map shape:

```json
{
  "OPENAI_API_KEY": "real-value",
  "TEST_WALLET_PRIVATE_KEY": "0x..."
}
```

## 2) How The Filter Works

Configured in `.gitattributes` with `filter=secretscrub`.

- Clean step (`git add`): replaces real values with placeholders (example: `<OPENAI_API_KEY>`) before content reaches the index.
- Smudge step (`checkout`): replaces placeholders back to local values in your working tree.

You can extend `.gitattributes` to apply the filter to additional text file types used by your repo.

Implementation: `scripts/secret-filter.py`.

## 3) Commit And CI Guardrails

- Local hook: `.githooks/pre-commit` -> `scripts/secret-guard.py --staged`
- CI check: `.github/workflows/agentic-secret-guard.yml`

The guard scans only **added lines** in staged/PR diffs to keep dev flow fast and reduce false positives.

## 4) Auditing Current State

Audit whether map-configured secrets still appear in `HEAD` or history:

```bash
./scripts/audit-history-secrets.sh
```

Exit code:
- `0`: no configured values found in HEAD/branches/pull refs.
- `1`: values found in HEAD or branch history.
- `3`: values found only in `refs/pull/*` (provider-managed pull refs).

## 5) Safe History Rewrite (Optional, High Impact)

Use this only when you want to remove already-committed secret values from Git history.

### Dry-run plan

```bash
./scripts/safe-history-rewrite.sh
```

### Execute rewrite locally (no push)

```bash
./scripts/safe-history-rewrite.sh --yes
```

### Execute rewrite and push rewritten refs/tags

```bash
./scripts/safe-history-rewrite.sh --yes --push
```

What this script does:

- Requires `git-filter-repo`.
- Clones a backup mirror.
- Clones a rewrite mirror.
- Rewrites the rewrite mirror with replacement rules derived from `.git-secrets-map.local.json` (or `--replacement-file`).
- Verifies replacement values no longer appear.
- Pushes only if `--push` is explicitly provided.

### GitHub pull-ref caveat

GitHub keeps `refs/pull/*` refs that are not updated by your normal branch force-pushes.  
If audit returns exit code `3`, main/branches are clean but pull refs still contain old objects.  
For complete eradication from pull refs and cached views, open a GitHub Support ticket and request sensitive-data purge for the specific values/commits.

## Optional: Scrub Local Claude Code Storage

If you use Claude Code, it stores local logs under `~/.claude/` (projects, plans, debug traces, file history, etc).
Those logs can contain secrets you pasted into prompts.

This project can **optionally** replace any secret values from your map file with placeholders in that local storage.

Dry-run (recommended first):

```bash
python3 scripts/scrub-claude-home.py --map-file .git-secrets-map.local.json
```

Apply (creates a timestamped backup directory under `~/.claude/` by default):

```bash
python3 scripts/scrub-claude-home.py --map-file .git-secrets-map.local.json --apply
```
