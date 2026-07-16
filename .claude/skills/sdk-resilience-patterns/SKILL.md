---
name: sdk-resilience-patterns
description: Verified SDK resilience patterns: structured errors, retries, persistence, timeouts, and tenant-scoped knowledge caching. Use when extending client error handling, retry logic, persistence, or cached reads.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# SDK Resilience Patterns

Verified working patterns for error handling, retry logic, and persistence in the rickydata SDK. All patterns confirmed working 2026-03-15 (491 tests pass, zero type errors).

## Pattern 1: Structured Error Taxonomy

**Provenance:** Verified 2026-03-15. Informed by paper 2601.16280 (12-category error taxonomy). Implemented as `AgentErrorCode` enum + `AgentError` class in `packages/core/src/agent/types.ts`.

### When to Use

When adding new error paths to the agent client or MCP proxy. Use `AgentError` instead of raw `Error` so callers can branch on `error.code` and check `error.isRetryable`.

### Key Components

1. **`AgentErrorCode` enum** (13 codes in 5 groups): AUTH_REQUIRED/EXPIRED/FAILED, NETWORK_ERROR/TIMEOUT/CONNECTION_INTERRUPTED, SERVER_ERROR/RATE_LIMITED/NOT_FOUND, VALIDATION_ERROR, AGENT_ERROR/TOOL_ERROR/PARSE_ERROR

2. **`RETRYABLE_CODES` set**: AUTH_EXPIRED, NETWORK_ERROR, NETWORK_TIMEOUT, CONNECTION_INTERRUPTED, SERVER_ERROR, RATE_LIMITED. The retry helper checks `error.isRetryable` which derives from this set.

3. **`AgentError.fromHttpStatus(status, body, context)`** factory: Maps HTTP status codes to the correct `AgentErrorCode`. Use this at HTTP boundaries instead of manually constructing errors.
   - 401 -> AUTH_EXPIRED (retryable)
   - 404 -> NOT_FOUND (not retryable)
   - 429 -> RATE_LIMITED (retryable)
   - 5xx -> SERVER_ERROR (retryable)
   - other -> VALIDATION_ERROR (not retryable)

4. **`AgentErrorContext`**: Optional `{ agentId, sessionId, operation, statusCode }` for debugging. Always pass context when available.

### How to Add a New Error Code

1. Add the code to `AgentErrorCode` enum in `types.ts`
2. If retryable, add it to the `RETRYABLE_CODES` set
3. If it maps from an HTTP status, update `fromHttpStatus()`
4. Throw `new AgentError(AgentErrorCode.NEW_CODE, message, context)` at the error site

## Pattern 2: Retry with Backoff + Test Disablement

**Provenance:** Verified 2026-03-15. Informed by paper 2603.10555 (CD-Raft failover). Implemented as `retryWithBackoff()` in `packages/core/src/agent/agent-client.ts`.

### When to Use

When wrapping network calls that may fail transiently. The pattern automatically retries on retryable errors (transport, timeout, server errors) with exponential delays.

### Implementation

```typescript
private async retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  delays: number[] = [100, 500, 2000],
): Promise<T>
```

- Only retries if `AgentError.isRetryable` is true OR the error message matches transport patterns (`/timed out|timeout|terminated|abort|network|socket|fetch failed/i`)
- Delays: 100ms, 500ms, 2000ms (capped at last element for additional retries)
- Exposed via `ChatOptions.maxRetries` (defaults to 3)

### Critical: Test Disablement

**Key learning:** Retry wrappers interact with mock expectations. When testing error paths in unit tests, the retry logic will exhaust mocked fetch calls and cause confusing failures.

**Solution:** Pass `maxRetries: 0` in test assertions that test error handling:

```typescript
// WRONG: retry logic will consume extra mock calls
await expect(client.chat('agent', 'hi')).rejects.toThrow('...');

// CORRECT: disable retries when testing error paths
await expect(client.chat('agent', 'hi', { maxRetries: 0 })).rejects.toThrow('...');
```

Always expose a `maxRetries` (or equivalent) option in the public API so tests can disable retry behavior.

## Pattern 3: File-Backed Store with null-path Test Mode

**Provenance:** Verified 2026-03-15. Informed by paper 2603.10600 (trajectory memory). Implemented as `SessionStore` in `packages/core/src/agent/session-store.ts`.

### When to Use

When adding file-backed persistence to any SDK feature. The pattern provides a file-backed Map with TTL eviction and a `null` escape hatch for tests.

### Key Design Decisions

1. **`null` filePath = pure in-memory**: `constructor(filePath?: string | null)`. Pass `null` explicitly for tests. Omitting the argument uses the default path (`~/.rickydata/sessions.json`).

2. **Best-effort persistence**: Both `load()` and `save()` swallow errors silently. The store degrades to in-memory if the filesystem is unavailable.

3. **TTL eviction on read**: Expired entries are removed lazily in `get()`, not via background timers.

4. **Config integration**: `AgentClientConfig.sessionStorePath` accepts `string | null` and flows through to the store constructor. Tests pass `sessionStorePath: null`.

### Critical: Test Isolation

**Key learning:** File-backed stores cause test pollution when multiple tests share the default file path. Tests were loading stale sessions from previous runs.

**Solution:** Every test must pass `sessionStorePath: null`:

```typescript
// WRONG: reads/writes ~/.rickydata/sessions.json, causing cross-test pollution
const client = new AgentClient({ privateKey: KEY });

// CORRECT: pure in-memory, no filesystem side effects
const client = new AgentClient({ privateKey: KEY, sessionStorePath: null });
```

When adding a new file-backed feature to `AgentClientConfig`:
1. Accept `string | null` in the config type
2. Pass `null` to mean "in-memory only"
3. Update ALL existing tests to pass the null option

## Pattern 4: Connection Pool with TTL Cache

**Provenance:** Verified 2026-03-15. Implemented as `ensureInitialized()` in `packages/core/src/mcp/agent-mcp-proxy.ts`.

### When to Use

When wrapping RPC/HTTP endpoints that require an initialization handshake. Cache the init result with a TTL to avoid redundant round-trips.

### Implementation

- `initCache: Map<string, number>` — maps agentId to timestamp of last init
- `INIT_TTL = 10 * 60 * 1000` (10 minutes)
- `ensureInitialized()` checks cache, skips init if within TTL
- Tool cache has separate 5-min TTL (`TOOL_CACHE_TTL`)
- Cache invalidation on registry file change (via file watcher)

### Test Impact

Caching changes reduce the number of fetch/RPC calls. Update test mock expectations when adding caching:

```typescript
// Before caching: expect init + call = 2 fetches
// After caching: expect 1 fetch (init is cached from prior call)
```

## Pattern 5: Team Workflow Timeouts with AbortSignal Composition

**Provenance:** Verified 2026-03-15. Implemented in `executeTeamWorkflow()` in `packages/core/src/agent/agent-client.ts`.

### When to Use

When adding timeout support to long-running streaming operations. The pattern composes an internal timeout with an optional external `AbortSignal`.

### Implementation

```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const signal = options?.signal
  ? AbortSignal.any([controller.signal, options.signal])
  : controller.signal;
```

- Default timeout: 5 minutes (300,000ms)
- `AbortSignal.any()` composes internal timeout + external caller signal
- Throws `AgentError(NETWORK_TIMEOUT)` on timeout
- Always `clearTimeout(timeout)` in finally block

### Interface Pattern

```typescript
export interface TeamWorkflowOptions {
  timeoutMs?: number;  // Defaults to 300_000
  signal?: AbortSignal;  // Optional external signal
}
```

## Pattern 6: Tenant-Scoped Immutable Snapshot Cache

**Provenance:** Verified 2026-07-16 in `KnowledgeWorkClient` with 1,020 passing
core tests and a real local Home/UI reload. The settled IndexedDB reload rendered
the seven-stage pipeline in 157ms with no additional Home request.

### When to Use

Use this for authenticated, expensive reads whose response exposes an immutable
content/snapshot hash. Keep a request alias for freshness and a snapshot entry
for content-addressed reuse.

### Required Boundaries

1. Include a stable tenant/wallet scope in every cache key.
2. Clear the prior scope on wallet changes by default.
3. Keep all stores bounded (`MemoryKnowledgeWorkCacheStore` defaults to 128;
   the opt-in IndexedDB adapter defaults to 256).
4. Serve stale entries immediately and coalesce one background refresh.
5. Treat cache/store errors as fail-open retrieval errors, never auth bypasses.
6. Remove rejected read-session promises so a transient failure is retryable.

Persistent browser caching is opt-in because it stores decrypted private
knowledge on the device. Hosts must pass the authenticated wallet address via
`cacheScope`; a generic shared scope is not safe for multi-user hosts.

## Pattern 7: KFDB Error Identity + Response Metadata

**Provenance:** Verified 2026-07-16 with 25 focused KFDB client tests, all 1,020
core tests, all-package typecheck/tests/build, and Home's 3,735-test gate. Home
integrated both seams without private request patches.

### When to Use

Use this whenever a consumer performs exact Entity API reads or needs to
attribute client latency to KFDB without monkey-patching fetch.

### Required Boundaries

1. `KfdbEntityNotFoundError` means the exact endpoint ran successfully and its
   structured response identified the requested entity as absent.
2. A generic route/API 404 remains `KfdbHttpError`. Do not treat it as entity
   absence; consumers may need a compatibility scan fallback.
3. Preserve structured server fields on `KfdbHttpError`: status, message, code,
   details, request id, backend, Server-Timing, and parsed server duration.
4. Observe successful and failed HTTP responses through `onResponseMeta`.
   Observer exceptions are swallowed so telemetry cannot change retrieval.
5. `clientWaitMs` is client-observed header wait. Prefer `serverMs` only when
   the server exposes a duration header or parseable Server-Timing metric; do
   not infer server execution time from client wait.

Focused verification:

```bash
npx vitest run packages/core/tests/kfdb-client.test.ts
npm run build -w packages/core
```
