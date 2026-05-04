---
name: analysis-copilot-host-pattern
description: SDK host pattern for analysis assistants that insert SQL/KQL while a host app proxies Agent Gateway and KFDB execution server-side.
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash
---

# Analysis Copilot Host Pattern

## Purpose

Use this when SDK packages or host apps need a reusable chat/assistant surface that suggests SQL/KQL, inserts it into a host editor, and lets the host execute the query through its own backend.

## Verified

Verified 2026-05-04 from the Bench `/analysis` production rollout:

- The host normalized `https://rickydata.org/agents/rickydatascience-copilot` to `rickydatascience-copilot`.
- The host proxied Agent Gateway MCP chat server-side and forwarded the user bearer.
- The host validated copilot SQL before insertion and before execution.
- Copilot returned raw SQL and the host executed it through `/api/analysis/query`, returning 305 live benchmark rows.

## Setup/Prerequisites

- SDK UI components should support host-owned engines/actions rather than assuming direct Agent Gateway/KFDB networking.
- Host apps decide authentication, token refresh, query validation, and execution.
- SDK components can provide UI affordances for copy/insert/run, but should not require privileged KFDB credentials in browser code.

## Pattern

For a chat component or analysis panel:

1. The host passes an external engine or callback for `askCopilot(prompt, currentQuery, language)`.
2. The host backend normalizes the agent URL/slug and calls Agent Gateway.
3. The host extracts fenced SQL/KQL, validates read-only constraints, normalizes SQL whitespace, and returns insertable text.
4. The host executes SQL/KQL via a server route and returns rows/charts to the UI.

Verified returned query shape:

```sql
SELECT repo, provider, model, success, proof_verified FROM system_tenants.benchmark_runs WHERE campaign_id = 'benchmark_matrix_current' AND repo = 'Textualize/rich' ALLOW FILTERING
```

## Gotchas

- Do not make SDK chat components call `POST /agents/:id/mcp` directly when the host needs server-derived auth, auditing, or query guardrails.
- Do not trust agent output. Require host validation before insertion and again before execution.
- Prompt SQL assistants for raw rows; current Bench/KFDB analysis flow rejects `GROUP BY`, `HAVING`, and aggregate functions.
- Multiline SQL should be normalized by the host before execution; preserve whitespace inside quoted strings.

## Related Skills

- `external-engine-pattern` - let host apps provide their own state machine/networking.
- `wallet-adapter-pattern` - keep auth adapter framework-agnostic.
- `verification-analysis` - production proof discipline after deploys.
