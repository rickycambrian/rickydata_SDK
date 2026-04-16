---
name: execution-trace-recording
description: Verified pattern for recording agent interaction traces with dual-environment support (Node.js file persistence + browser in-memory). Use when adding trace instrumentation to AgentClient calls, building trace-aware wrappers, or extending the trace event schema.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Execution Trace Recording

Verified working patterns for recording agent execution traces in the rickydata SDK. Confirmed 2026-03-15 — SDK turbo build passes (5/5 packages), 10 ESM exports verified, DTS generates cleanly (Tasks #1, #2, #5).

## Pattern 1: Dual-Environment TraceRecorder

**Provenance:** Verified 2026-03-15. Implemented at `packages/trace/src/recorder.ts`. Used by TracedAgentClient and useTraceRecorder hook.

### When to Use

When recording trace events that must work in both Node.js (CLI, server) and browser (React apps). The recorder auto-detects the environment and persists accordingly.

### The TraceEvent Schema

```typescript
export interface TraceEvent {
  id: string;           // Generated: timestamp-based (Date.now().toString(36) + counter)
  timestamp: string;    // ISO-8601
  type:
    | 'session_start' | 'session_end'
    | 'message_sent' | 'message_received'
    | 'tool_call' | 'tool_result'
    | 'sse_text' | 'sse_done'
    | 'error' | 'agent_action' | 'custom';
  sessionId?: string;
  agentId?: string;
  data: Record<string, unknown>;
  durationMs?: number;  // Present on timed events (sse_done, error)
}
```

### Key Design Decisions

1. **`isNode()` environment detection**: Uses `typeof window === 'undefined'` — simple, no polyfill needed. Checked at `packages/trace/src/utils.ts`.

2. **Lazy Node.js module loading**: `fs` and `path` are loaded via `require()` on first write, not at import time. This prevents bundler warnings in browser environments:
   ```typescript
   private fs: typeof import('node:fs') | null = null;
   // ...
   if (!this.fs) {
     this.fs = require('node:fs');
     this.path = require('node:path');
   }
   ```

3. **Write-through persistence**: Each event is appended to `{outputDir}/{sessionId}.jsonl` immediately via `appendFileSync`. No batching — simple and crash-safe.

4. **Non-fatal writes**: File operations are wrapped in try/catch with empty catch. Trace recording must never crash the host application.

5. **File rotation**: When a trace file exceeds `maxFileSize` (default 10MB), it's renamed to `{path}.{timestamp}` before writing continues.

6. **Default output directory**: `~/.Codex/traces/` (resolved lazily via `os.homedir()`).

### Session Lifecycle

```typescript
const recorder = new TraceRecorder({ outputDir: '/tmp/traces' });

// Start — creates session, records session_start event
const sessionId = recorder.startSession('my-agent', { model: 'sonnet' });

// Record — adds event to session + writes to disk (Node.js)
recorder.record({
  type: 'tool_call',
  sessionId,
  agentId: 'my-agent',
  data: { name: 'search', args: { query: 'test' } },
});

// End — records session_end with event count + duration, clears active session
recorder.endSession(sessionId);
```

### Critical: onEvent Callback for React Integration

The `TraceRecorderConfig.onEvent` callback is how the React `useTraceRecorder` hook gets live updates. The recorder calls `onEvent(event)` for every recorded event, which the hook uses to update its `events` state array.

## Pattern 2: TracedAgentClient Wrapper

**Provenance:** Verified 2026-03-15. Implemented at `packages/trace/src/traced-client.ts`. Wraps the core `AgentClient`.

### When to Use

When instrumenting an existing `AgentClient` with automatic trace recording. The wrapper intercepts `createSession`, `chatRaw`, and SSE streaming without modifying the underlying client.

### Implementation

```typescript
const traced = new TracedAgentClient({
  client: existingAgentClient,
  trace: { outputDir: '/tmp/traces', enabled: true },
});

// Session creation — auto-records session_start + gateway session mapping
const session = await traced.createSession('my-agent', 'sonnet');

// Chat — auto-records message_sent event before delegating
const response = await traced.chatRaw('my-agent', session.id, 'Hello');

// Stream — records each SSE event type (text, tool_call, tool_result, done, error)
await traced.streamWithTrace(response, (event) => {
  // Your handler — called after trace recording
  console.log(event);
});
```

### SSE Event Type Mapping

The `streamWithTrace` method maps SSE events to trace events:

| SSE Event Type | Trace Event Type | Recorded Data |
|---|---|---|
| `text` | `sse_text` | `{ text }` |
| `tool_call` | `tool_call` | `{ name, displayName, args, id }` |
| `tool_result` | `tool_result` | `{ id, name, isError, result }` |
| `done` | `sse_done` | `{ cost, costRaw, balanceRemaining, usage, toolCallCount }` + `durationMs` |
| `error` | `error` | `{ code, message }` + `durationMs` |

### Critical: Stream Timing via Date.now() Deltas

Stream duration is measured using `Date.now()` captured at stream start, then computed as `Date.now() - streamStart` when `done` or `error` events arrive. This gives wall-clock stream duration without importing any timing library.

### Critical: Forward-Then-Record Pattern

The wrapper calls `onEvent(event)` (the caller's handler) after recording the trace event. This ensures traces are always recorded even if the caller's handler throws.

## Pattern 3: JSONL File Format

**Provenance:** Verified 2026-03-15. Written by `TraceRecorder.writeEvent()`.

### When to Use

When reading or processing trace files produced by the recorder.

### Format

Each line is a self-contained JSON object (newline-delimited JSON):

```jsonl
{"id":"m3abc-0","timestamp":"2026-03-15T22:30:00.000Z","type":"session_start","sessionId":"m3abc","agentId":"my-agent","data":{"metadata":{}}}
{"id":"m3abd-1","timestamp":"2026-03-15T22:30:01.000Z","type":"tool_call","sessionId":"m3abc","data":{"name":"search","args":{"query":"test"}}}
{"id":"m3abe-2","timestamp":"2026-03-15T22:30:02.000Z","type":"sse_done","sessionId":"m3abc","durationMs":1500,"data":{"cost":"0.003","toolCallCount":1}}
```

File location: `{outputDir}/{sessionId}.jsonl` (one file per session).

### Reading Traces

```typescript
import { readFileSync } from 'node:fs';
import type { TraceEvent } from '@rickydata/trace';

const events: TraceEvent[] = readFileSync('session.jsonl', 'utf-8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
```

## Known Limitations

- Browser mode is in-memory only — no IndexedDB or localStorage persistence. Sessions are lost on page refresh.
- `flush()` is a no-op in the current JSONL write-through strategy. It exists for future batched-write support.
- The `TracedAgentClient` wraps `createSession`, `chatRaw`, and streaming. Other `AgentClient` methods (secrets, voice, team workflows) are not wrapped — access them via `traced.client.*`.
- File rotation renames the old file but does not compress or clean up rotated files.
- ID generation uses `Date.now().toString(36) + counter` — unique within a single process but not globally unique across distributed systems.
