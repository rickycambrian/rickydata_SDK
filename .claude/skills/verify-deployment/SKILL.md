---
name: verify-deployment
description: Create or run a post-deployment verification workflow for a service. Use when setting up deployment verification, adding health checks to a repo, or debugging production after a deploy.
argument-hint: [repo-name or service-url]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Post-Deployment Verification

Create or run automated post-deployment verification for services. This pattern has been verified working across 4 repos: knowledgeflow_db (GKE), rickydata_docs (Cloud Run), KF-serverless (Cloud Run), and canvas-workflows (Cloud Run).

**Provenance:** Verified working 2026-03-15. Deployed and validated via `workflow_dispatch` on all 4 repos. Concurrency guard validated on rickydata_docs (cancel-in-progress confirmed). Auto-close mechanism validated on knowledgeflow_db (issue #27 auto-closed on successful run). Maintenance mode validated on rickydata_docs (SKIP_VERIFICATION=true → job skipped, then unset → job ran normally). End-to-end lifecycle validated on knowledgeflow_db: forced failure (commit 414a666, threshold=1ms) → issue #28 created → fix (commit b8b22cb, threshold=500ms) → issue #28 auto-closed. Run IDs: knowledgeflow_db/23112445668, rickydata_docs/23112446229, KF-serverless/23112452922, canvas-workflows/23112453446. Maintenance mode run IDs: rickydata_docs/23112707623 (skipped), rickydata_docs/23112714505 (success after unset). Lifecycle run IDs: knowledgeflow_db/23112741606 (failure, issue #28 created), knowledgeflow_db/23112763852 (success, issue #28 auto-closed).

## Verified Architecture

The pattern consists of two files per repo:

### 1. GitHub Action Workflow (`.github/workflows/verify-deployment.yml`)

```yaml
on:
  workflow_run:
    workflows: ["Your Deploy Workflow Name"]
    types: [completed]
  workflow_dispatch:  # Manual trigger

concurrency:
  group: verify-deployment-${{ github.event.workflow_run.head_sha || github.sha }}
  cancel-in-progress: true
```

**Hardening patterns** (all verified working 2026-03-15):

1. **Concurrency guard**: `concurrency: group: verify-deployment-${{ head_sha }}` with `cancel-in-progress: true` — prevents duplicate verification runs for the same commit. Validated: rapid double-trigger on rickydata_docs correctly cancelled the first run.
2. **[skip-verify] suppression**: Add `if: !contains(github.event.workflow_run.head_commit.message, '[skip-verify]')` to the job — allows skipping verification for documentation-only changes.
3. **Maintenance mode**: Add `if: vars.SKIP_VERIFICATION != 'true'` to the job — set the `SKIP_VERIFICATION` repo variable to `true` during planned maintenance windows. Validated: rickydata_docs with `SKIP_VERIFICATION=true` → run 23112707623 skipped; after variable deletion → run 23112714505 succeeded normally.
4. **Standardized timeouts**: Use env vars `HEALTH_POLL_ATTEMPTS: 36` and `HEALTH_POLL_INTERVAL: 5` (3 minutes total) instead of hardcoded values.
5. **Auto-close on recovery**: A `github-script` step in `report-success` that closes open `deploy-verification` issues when verification passes. Validated: knowledgeflow_db issue #27 auto-closed on successful run. Full lifecycle validated: forced failure (run 23112741606) created issue #28, then fix + re-run (run 23112763852) auto-closed issue #28.

Key steps:
1. **Gate on success**: `if: github.event.workflow_run.conclusion == 'success'`
2. **Resolve URLs**: For Cloud Run, use `gcloud run services describe` to get URL. For GKE, hardcode the IP.
3. **Poll health**: Loop `curl /health` with `HEALTH_POLL_ATTEMPTS` and `HEALTH_POLL_INTERVAL` env vars until 200.
4. **Run verification script**: `node .github/scripts/verify-*.mjs <base-url>` — stdout is JSON, stderr is human-readable.
5. **On success**: Post summary to `$GITHUB_STEP_SUMMARY` and auto-close any open deploy-verification issues.
6. **On failure**: Create GitHub issue with `deploy-verification` label (or comment on existing open issue to avoid duplicates).

### 2. Verification Script (`.github/scripts/verify-*.mjs`)

Node.js script pattern:

```javascript
// timedFetch — wraps fetch with AbortController timeout + elapsed timing
async function timedFetch(url, options = {}) {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(timeout);
  return { ok: response.ok, status: response.status, elapsed: Date.now() - start, body };
}

// addResult — accumulates check results with pass/fail + timing
function addResult(name, passed, details) {
  results.checks.push({ name, passed, ...details });
  results.summary.total++;
  if (passed) results.summary.passed++; else results.summary.failed++;
}

// Each check: timedFetch + threshold comparison + addResult
// Output: JSON to stdout, logs to stderr
// Exit: 0 for pass, 1 for fail
```

## Steps to Add Verification to a New Repo

1. **Identify endpoints to check**: Health, readiness, key API routes
2. **Set thresholds**: Health < 500ms, readiness < 3s, API < 5s (adjust per service)
3. **Create the script** at `.github/scripts/verify-deployment.mjs`:
   - Import nothing (uses native fetch, Node 20+)
   - Accept base URL as `process.argv[2]`
   - Define `timedFetch()`, `addResult()`, and individual check functions
   - Output structured JSON to stdout, human logs to stderr
4. **Create the workflow** at `.github/workflows/verify-deployment.yml`:
   - Trigger on `workflow_run` after the deploy workflow
   - Add `workflow_dispatch` for manual testing
   - Add concurrency guard: `concurrency: group: verify-deployment-${{ head_sha }}, cancel-in-progress: true`
   - Add skip conditions: `[skip-verify]` in commit message and `vars.SKIP_VERIFICATION` repo variable
   - Use env vars for health polling: `HEALTH_POLL_ATTEMPTS: 36`, `HEALTH_POLL_INTERVAL: 5`
   - Poll health endpoint before running verification
   - Create GitHub issue on failure (with `deploy-verification` label)
   - Use issue deduplication: check for existing open issues before creating new ones
   - Add auto-close step: close open deploy-verification issues on successful run
5. **Test**: Run via `workflow_dispatch` first, then verify it triggers after a real deploy

## Existing Implementations

| Repo | Service Type | Endpoints Checked | Hardening |
|------|-------------|-------------------|-----------|
| `knowledgeflow_db` | GKE | /health, /health/live, /health/ready, /health/diagnostics, /api/v1/entities/labels, /api/v1/query | All 5 patterns |
| `rickydata_docs` | Cloud Run | /health, /api/public/nav, / (SPA shell) | All 5 patterns |
| `KF-serverless` | Cloud Run | /health (+ service-specific) | All 5 patterns |
| `canvas-workflows` | Cloud Run | /health (+ service-specific) | All 5 patterns |

## Issue Deduplication Pattern

```javascript
// Check for existing open issue with deploy-verification label
const existing = await github.rest.issues.listForRepo({
  owner, repo, state: 'open', labels: 'deploy-verification', per_page: 5
});
if (existing.data.length > 0) {
  // Comment on existing issue
  await github.rest.issues.createComment({ owner, repo, issue_number: existing.data[0].number, body });
} else {
  // Create label if needed, then create issue
  await github.rest.issues.create({ owner, repo, title, body, labels: ['deploy-verification'] });
}
```

## Auto-Close on Recovery Pattern

```javascript
// In the report-success job, close any open deploy-verification issues
const issues = await github.rest.issues.listForRepo({
  owner, repo, state: 'open', labels: 'deploy-verification', per_page: 10
});
for (const issue of issues.data) {
  await github.rest.issues.createComment({
    owner, repo, issue_number: issue.number,
    body: `Verification passing again as of run ${context.runId}. Auto-closing.`
  });
  await github.rest.issues.update({
    owner, repo, issue_number: issue.number, state: 'closed'
  });
}
```

## Known Limitations

- Health polling is sequential (not parallel) to fail early on basic connectivity
- Cloud Run URLs must be resolved via `gcloud` (requires GCP auth in Actions)
- Issue deduplication uses label-based lookup — only one open issue at a time per label
- timedFetch uses a 15s hard timeout — adjust for slow cold starts
- **Repo name mismatch**: The GitHub repo is `KF-serverless` (hyphen) but some scripts (e.g., ai_research aggregation) reference `KF_serverless` (underscore). Use the hyphenated form when calling GitHub APIs.
