---
name: canvas-client-patterns
description: Verified patterns for the CanvasClient — SSE timeout/heartbeat, typed HTTP errors, getRunWithRetry, and ParseFailureReason diagnostics. Use when adding or debugging canvas workflow execution, run polling, or review result parsing.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Canvas Client Patterns

Verified working patterns for canvas workflow execution, run polling, and review result parsing. All confirmed 2026-03-15 — 560 tests pass, zero type errors.

## Pattern 1: SSE Timeout + Heartbeat Idle Detection

**Provenance:** Verified 2026-03-15. Implemented in `packages/core/src/canvas/canvas-client.ts`. Tests in `packages/core/tests/canvas-client.test.ts` — `timeout` and `heartbeat` describe blocks, all passing.

### When to Use

When streaming canvas workflows that may hang (proxy drops, server crash, long-running multi-agent teams). Pass `timeoutMs` to cap total duration and `heartbeatTimeoutMs` to detect idle connections.

### Interface

```typescript
export interface ExecuteWorkflowOptions {
  signal?: AbortSignal;       // Caller-provided cancellation signal
  timeoutMs?: number;         // Hard wall-clock limit (e.g., 300_000 for 5 min)
  heartbeatTimeoutMs?: number; // Idle detection — aborts if no data arrives within this window
}
```

### Usage

```typescript
// Hard timeout only
for await (const event of client.executeWorkflow(request, { timeoutMs: 300_000 })) {
  // ...
}

// Heartbeat only (aborts if stream goes silent for 30s)
for await (const event of client.executeWorkflow(request, { heartbeatTimeoutMs: 30_000 })) {
  // ...
}

// Both together
for await (const event of client.executeWorkflow(request, {
  timeoutMs: 300_000,
  heartbeatTimeoutMs: 30_000,
  signal: controller.signal,
})) {
  // ...
}

// Backward-compatible: bare AbortSignal still accepted
for await (const event of client.executeWorkflow(request, controller.signal)) {
  // ...
}
```

### Implementation Pattern

The method uses three separate abort mechanisms composed via a single `AbortController`:

1. **User signal**: listened via `addEventListener('abort', ...)` — forwards to internal controller
2. **Overall timer**: `setTimeout(() => controller.abort(new Error('...timed out after Xms')), timeoutMs)`
3. **Heartbeat timer**: reset via `resetHeartbeat()` on every chunk; fires if no data arrives within the window

Errors thrown:
- Timeout: `Error('Canvas workflow timed out after Xms')`
- Heartbeat: `Error('SSE stream idle for Xms (no data received)')`

Always `clearTimeout()` in a `finally` block.

### Critical: Reader Abort Propagation

Some environments don't propagate fetch abort to the body stream reader. Add a defense-in-depth listener:

```typescript
const onAbort = () => { reader.cancel().catch(() => {}); };
controller.signal.addEventListener('abort', onAbort, { once: true });
// ... stream reading ...
// In finally:
controller.signal.removeEventListener('abort', onAbort);
reader.releaseLock();
```

## Pattern 2: Typed `CanvasHttpError` at All HTTP Boundaries

**Provenance:** Verified 2026-03-15. `CanvasHttpError` added to `packages/core/src/errors/index.ts`. Used in all `CanvasClient` methods. Tests verify `instanceof CanvasHttpError` and `.status` field.

### When to Use

At every `!res.ok` check in `CanvasClient`. Enables callers (and `getRunWithRetry`) to branch on specific HTTP status codes without string-matching error messages.

### Pattern

```typescript
import { CanvasHttpError } from '../errors/index.js';

if (!res.ok) {
  const body = await res.text();
  throw new CanvasHttpError(res.status, `Operation failed: ${res.status} ${body.slice(0, 200)}`);
}
```

**Key detail**: Truncate body to 200 chars — canvas error responses can be large HTML pages.

### `CanvasHttpError` class

```typescript
export class CanvasHttpError extends MCPGatewayError {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CanvasHttpError';
    this.status = status;
  }
}
```

## Pattern 3: `getRunWithRetry` — Exponential Backoff for 404s

**Provenance:** Verified 2026-03-15. Implemented in `packages/core/src/canvas/canvas-client.ts`. Handles DB replication lag on the Agent Gateway — a run ID may return 404 for up to ~1s after `run_started` fires.

### When to Use

After capturing a `runId` from an SSE stream, before polling `getRun()` in a fallback path (e.g., stream dropped before completion).

### Interface

```typescript
async getRunWithRetry(
  runId: string,
  options?: { maxAttempts?: number; initialDelayMs?: number; signal?: AbortSignal },
): Promise<CanvasRunState>
```

Defaults: `maxAttempts: 5`, `initialDelayMs: 200`. Back-off: `delay = Math.min(delay * 2, 5_000)` — sequence: 200ms → 400ms → 800ms → 1600ms → 5000ms cap.

### Implementation Pattern

```typescript
// CORRECT: type-safe 404 detection using CanvasHttpError
const is404 = err instanceof CanvasHttpError && err.status === 404;

// WRONG: string matching is fragile
const is404 = err instanceof Error && err.message.includes('404');
```

Only retries on 404. All other errors propagate immediately. Also checks `options?.signal?.aborted` before sleeping.

## Pattern 4: `ParseFailureReason` — Silent-Failure Diagnostics

**Provenance:** Verified 2026-03-15. Implemented in `packages/core/src/canvas/parse-review-results.ts`. Verified in unit tests for `parseCanvasReviewResult`.

### When to Use

When `parseCanvasReviewResult()` returns `findings: []`. Check `result.parseWarning` for a machine-readable reason instead of guessing why the parse failed.

### Diagnostic Type

```typescript
export type ParseFailureReason =
  | 'no_agent_events'        // SSE stream had zero team_agent_event entries
  | 'events_but_no_json'     // Events found but no parseable JSON in any candidate
  | 'json_but_no_findings_key' // JSON parsed but no "findings" array key
  | 'findings_empty_array';  // findings key present but array was empty
```

### Usage

```typescript
const parsed = parseCanvasReviewResult(result);
if (parsed.findings.length === 0 && parsed.parseWarning) {
  const { reason, message, candidatesInspected, longestCandidateLength } = parsed.parseWarning;
  // reason → one of the 4 ParseFailureReason values
  // message → human-readable explanation
  // candidatesInspected → how many strings were tried
  // longestCandidateLength → length of best candidate (0 = nothing found)
}
```

### Search Order in `parseCanvasReviewResult`

The function searches for findings in this priority order:
1. Results node outputs (`results-1`, `agent-team-orchestrator-1` keys, then all result values)
2. `team_agent_event` SSE events with `eventKind: 'agent_completed'`
3. All `team_agent_event` messages (any `eventKind`)

If all fail, `parseWarning` explains which diagnostic category applies.

## Pattern 5: Shared `extractSSEData` from Agent Module

**Provenance:** Verified 2026-03-15. `extractSSEData` consolidated from canvas-client into `packages/core/src/agent/index.js` and re-imported. Eliminates duplicate SSE parsing logic.

### When to Use

When parsing SSE streams in any new client. Import from the shared location instead of copying.

```typescript
import { extractSSEData } from '../agent/index.js';
```

Returns the data payload string from a single SSE chunk, or `null` if no `data:` line found. Handles both `data: value` and `data:value` variants.

## Known Limitations

- `heartbeatTimeoutMs` resets on every chunk, not every parsed SSE event — very large chunks trigger a reset even if no complete event was parsed
- `getRunWithRetry` only retries 404; a transient 503 will propagate immediately
- `ParseFailureReason` diagnostics require the caller to explicitly check `parseWarning` — no exception is thrown on parse failure
