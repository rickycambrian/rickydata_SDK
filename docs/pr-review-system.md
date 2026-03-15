# PR Review System

Automated multi-agent code review for GitHub pull requests. Comment `@rickydata review` on any PR to trigger a team of 6 specialist AI agents that analyze the diff and post findings as inline PR comments.

## How to Trigger

Add a comment on any pull request:

```
@rickydata review
```

The GitHub Action reacts with an "eyes" emoji, posts an acknowledgment comment, and starts the review. Findings appear as a GitHub PR review with inline comments on specific lines.

## What Gets Reviewed

Six specialist agents analyze the diff in parallel:

| Agent | Focus |
|-------|-------|
| **security** | Injection attacks, auth bypass, exposed secrets, unsafe dependencies, weak crypto |
| **correctness** | Logic errors, null handling, edge cases, type mismatches, race conditions |
| **performance** | N+1 queries, unnecessary allocations, algorithmic complexity, missing caching |
| **test_coverage** | Missing test cases, untested branches, weak assertions, over-mocking |
| **style** | Naming conventions, file organization, consistency, dead code |
| **architecture** | Coupling, abstraction quality, API surface, breaking changes |

An orchestrator agent aggregates and deduplicates findings from all agents, producing a prioritized list with severity levels: critical, major, minor, nit, or praise.

## How Findings Appear

Findings are posted as a GitHub PR review:

- **Inline comments** are attached to specific files and lines in the diff
- **General findings** (no specific file/line) appear in the review summary
- The review event is `REQUEST_CHANGES` if any critical or major findings exist, otherwise `COMMENT`
- Each finding includes severity, category, title, explanation, and optional code suggestion

## Authentication

The review system uses **GitHub OIDC** for zero-secret authentication:

1. The GitHub Actions workflow requests an OIDC token (requires `permissions: id-token: write`)
2. `AuthManager.authenticateWithGitHubOIDC()` exchanges the token at the Agent Gateway's `/auth/github/exchange` endpoint
3. The gateway verifies the token against GitHub's JWKS and checks for an active rickydata GitHub App installation
4. A short-lived session token is returned for the canvas workflow execution

No stored secrets are needed beyond the default `GITHUB_TOKEN` provided by GitHub Actions.

## Setup

1. Install the rickydata GitHub App on your repository
2. Copy `.github/workflows/rickydata-review.yml` into your repo (or reference it from the SDK repo)
3. The workflow triggers automatically on PR comments containing `@rickydata review`

## CLI Usage

The review can also be run from the command line:

```bash
# Stream review output to terminal
rickydata github review owner/repo#42

# JSON output (used by CI)
rickydata github review owner/repo#42 --json

# Use a local diff file (direct mode, no GitHub App needed)
rickydata github review owner/repo#42 --diff-file changes.diff

# Select specific agents
rickydata github review owner/repo#42 --agents security,correctness

# Choose a different model
rickydata github review owner/repo#42 --model opus

# Post results as a GitHub PR review
rickydata github review owner/repo#42 --post-github

# Check status of an async review run
rickydata github review-status <run-id>
```

### Workflow Modes

- **direct** (default) — The PR diff is embedded directly in the canvas text-input node. Works without a GitHub App installation on the target repo.
- **github-repo** — Adds a `github-repo` node to the canvas workflow so the server fetches repository context. Requires a GitHub App installation.

## Architecture

```
PR comment "@rickydata review"
    │
    ▼
GitHub Actions workflow (rickydata-review.yml)
    │
    ├── Acknowledge (react + comment)
    ├── Fetch PR diff (gh pr diff)
    ├── OIDC auth (no secrets)
    │
    ▼
rickydata github review --diff-file --json
    │
    ▼
Canvas Workflow (buildPRReviewWorkflow)
    ├── text-input node (PR metadata + diff)
    ├── agent-team-orchestrator node
    │     ├── teammate: security
    │     ├── teammate: correctness
    │     ├── teammate: performance
    │     ├── teammate: test_coverage
    │     ├── teammate: style
    │     └── teammate: architecture
    └── results node
    │
    ▼
Parse + Format Pipeline
    ├── parseCanvasReviewResult() → ReviewFinding[]
    └── formatGitHubReview() → GitHubReviewPayload
    │
    ▼
Post as GitHub PR Review (inline comments + summary)
```
