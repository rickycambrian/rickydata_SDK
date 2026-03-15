---
name: review-pr
description: Run a multi-agent team code review on a GitHub PR. Use when the user wants to review a PR, analyze code changes, or trigger @rickydata review.
argument-hint: <owner/repo#number>
allowed-tools: Bash, Read
---

# Review a Pull Request

Run a 6-agent team review on a GitHub PR using the rickydata canvas workflow engine.

**Provenance:** Verified working 2026-03-15. PR review system built in rickydata SDK with GitHub Action at `.github/workflows/rickydata-review.yml`, CLI at `packages/core/src/cli/commands/github.ts`, and canvas pipeline at `packages/core/src/canvas/pr-review-workflow.ts`.

## Quick Start

```bash
rickydata github review $ARGUMENTS
```

## What the 6 Agents Review

| Agent | Focus |
|-------|-------|
| **security** | Injection attacks, auth bypass, exposed secrets, unsafe deps, weak crypto |
| **correctness** | Logic errors, null handling, edge cases, type mismatches, race conditions |
| **performance** | N+1 queries, unnecessary allocations, complexity, missing caching |
| **test_coverage** | Missing tests, untested branches, weak assertions, over-mocking |
| **style** | Naming conventions, file organization, consistency, dead code |
| **architecture** | Coupling, abstraction quality, API surface, breaking changes |

## Common Usage Patterns

### Stream review to terminal
```bash
rickydata github review owner/repo#42
```

### JSON output (for CI or parsing)
```bash
rickydata github review owner/repo#42 --json
```

### Use a local diff file (no GitHub App needed)
```bash
gh pr diff 42 > /tmp/pr.diff
rickydata github review owner/repo#42 --diff-file /tmp/pr.diff
```

### Select specific agents
```bash
rickydata github review owner/repo#42 --agents security,correctness
```

### Post results as GitHub PR review with inline comments
```bash
rickydata github review owner/repo#42 --post-github
```

### Check status of an async review run
```bash
rickydata github review-status <run-id>
```

## Key Flags

| Flag | Description |
|------|-------------|
| `--model <model>` | Model for all agents (default: sonnet) |
| `--agents <roles>` | Comma-separated agent roles to run |
| `--diff-file <path>` | Read PR diff from local file instead of server |
| `--mode <direct\|github-repo>` | `direct` embeds diff (no GitHub App needed), `github-repo` uses repo node |
| `--json` | Output final result as JSON |
| `--post-github` | Parse results and post as GitHub PR review |
| `--verbose` | Show all SSE events |

## Workflow Modes

- **direct** (default): Embeds the PR diff in the canvas text-input node. Works without a GitHub App installation.
- **github-repo**: Adds a `github-repo` node so the server fetches repo context. Requires GitHub App.

## Authentication

- **Local**: Requires `rickydata auth login` or `RICKYDATA_TOKEN` env var
- **GitHub Actions**: Uses OIDC automatically (`permissions: id-token: write`) — no stored secrets needed

## Pipeline Architecture

`buildPRReviewWorkflow()` builds the canvas payload, then:
1. Canvas workflow executes with agent-team-orchestrator + 6 teammate nodes
2. `parseCanvasReviewResult()` extracts `ReviewFinding[]` from results/SSE events
3. `formatGitHubReview()` converts findings to `GitHubReviewPayload` with inline comments
