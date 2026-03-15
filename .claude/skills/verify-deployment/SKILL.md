---
name: verify-deployment
description: Create or run a post-deployment verification workflow for a service. Use when setting up deployment verification, adding health checks to a repo, or debugging production after a deploy.
argument-hint: [repo-name or service-url]
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Post-Deployment Verification

Create or run automated post-deployment verification for services. This pattern has been verified working across knowledgeflow_db (GKE) and rickydata_docs (Cloud Run).

**Provenance:** Verified working 2026-03-15. Deployed in knowledgeflow_db (`.github/workflows/verify-deployment.yml`) and rickydata_docs (`.github/workflows/verify-deployment.yml`).

## Verified Architecture

The pattern consists of two files per repo:

### 1. GitHub Action Workflow (`.github/workflows/verify-deployment.yml`)

```yaml
on:
  workflow_run:
    workflows: ["Your Deploy Workflow Name"]
    types: [completed]
  workflow_dispatch:  # Manual trigger
```

Key steps:
1. **Gate on success**: `if: github.event.workflow_run.conclusion == 'success'`
2. **Resolve URLs**: For Cloud Run, use `gcloud run services describe` to get URL. For GKE, hardcode the IP.
3. **Poll health**: Loop `curl /health` up to 30 attempts with 10s interval until 200.
4. **Run verification script**: `node .github/scripts/verify-*.mjs <base-url>` — stdout is JSON, stderr is human-readable.
5. **On success**: Post summary to `$GITHUB_STEP_SUMMARY`.
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
   - Poll health endpoint before running verification
   - Create GitHub issue on failure (with `deploy-verification` label)
   - Use issue deduplication: check for existing open issues before creating new ones
5. **Test**: Run via `workflow_dispatch` first, then verify it triggers after a real deploy

## Existing Implementations

| Repo | Service Type | Endpoints Checked |
|------|-------------|-------------------|
| `knowledgeflow_db` | GKE | /health, /health/live, /health/ready, /health/diagnostics, /api/v1/entities/labels, /api/v1/query |
| `rickydata_docs` | Cloud Run | /health, /api/public/nav, / (SPA shell) |

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

## Known Limitations

- Health polling is sequential (not parallel) to fail early on basic connectivity
- Cloud Run URLs must be resolved via `gcloud` (requires GCP auth in Actions)
- Issue deduplication uses label-based lookup — only one open issue at a time per label
- timedFetch uses a 15s hard timeout — adjust for slow cold starts
