---
name: trace-viewer-component
description: Verified pattern for rendering agent execution traces as scrollable event lists and compact SVG timelines. Use when building trace visualization UI, extending trace components, or adding new event type rendering.
disable-model-invocation: true
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Trace Viewer Component

Verified working patterns for trace visualization components in the rickydata SDK. Confirmed 2026-03-15 — SDK turbo build passes (5/5 packages), DTS generates cleanly (Tasks #3, #5).

## Pattern 1: TraceViewer — Scrollable Event List

**Provenance:** Verified 2026-03-15. Implemented at `packages/trace/src/components/TraceViewer.tsx`.

### When to Use

When rendering a full trace event log with collapsible detail panels. Good for debug views and trace inspection.

### Props Interface

```typescript
export interface TraceViewerProps {
  events: TraceEvent[];              // Array of trace events to render
  theme?: Partial<TraceThemeTokens>; // Override CSS custom properties
  maxHeight?: string;                // Scrollable container height (default: '400px')
  className?: string;                // Optional CSS class on container
}
```

### Key Design Decisions

1. **CSS custom properties, not Tailwind**: All styles use `var(--trace-*)` tokens injected via `injectTraceTheme()` on the container ref. Matches the `@rickydata/chat` pattern (`var(--chat-*)`).

2. **Click-to-expand detail**: Each event row toggles between a summary line and a full JSON `<pre>` dump. State tracked via `expandedIds: Set<string>`.

3. **Auto-scroll on new events**: `useEffect` on `events.length` scrolls `containerRef` to bottom. Keeps the latest events visible during live streaming.

4. **Relative timestamps**: Displays `+1.2s`, `+3.5s` etc. relative to the first event's timestamp. Uses `Date.getTime()` delta math, no external library.

5. **Inline styles only**: All styling is inline — no CSS files, no CSS-in-JS library. This is the SDK convention for framework-agnostic components.

### Event Row Layout

Each event renders as a flex row:
```
[+1.2s] [SSE TEXT] [150ms] {"text":"Hello..."}
```
- Timestamp (monospace, muted)
- Type badge (colored background, uppercase, 10px)
- Duration badge (only if `durationMs` is present)
- Data summary (truncated JSON, flex: 1)

### Event Type Color Map

Colors are resolved from CSS custom properties:

| Event Type | CSS Variable |
|---|---|
| `session_start`, `session_end` | `--trace-color-session` (purple `#a78bfa`) |
| `message_sent`, `message_received` | `--trace-color-message` (blue `#60a5fa`) |
| `tool_call`, `tool_result` | `--trace-color-tool` (sky `#38bdf8`) |
| `sse_text` | `--trace-color-sse` (green `#34d399`) |
| `sse_done` | `--trace-color-done` (bright green `#4ade80`) |
| `error` | `--trace-color-error` (red `#f87171`) |
| `agent_action` | `--trace-color-action` (amber `#fbbf24`) |
| `custom` | `--trace-color-custom` (slate `#94a3b8`) |

## Pattern 2: TraceTimeline — Compact SVG Visualization

**Provenance:** Verified 2026-03-15. Implemented at `packages/trace/src/components/TraceTimeline.tsx`.

### When to Use

When embedding a compact trace overview in sidebars, panels, or summary cards. Renders events as dots on a horizontal timeline with optional duration bars.

### Props Interface

```typescript
export interface TraceTimelineProps {
  events: TraceEvent[];              // Array of trace events
  theme?: Partial<TraceThemeTokens>; // Override CSS custom properties
  height?: number;                   // SVG height in pixels (default: 48)
  className?: string;                // Optional CSS class
}
```

### Key Design Decisions

1. **SVG rendering, not canvas**: Uses inline SVG with `viewBox="0 0 100 {height}"` and `preserveAspectRatio="none"`. This scales cleanly to any container width.

2. **Normalized positioning**: Events are positioned at `x = (eventTime - startTime) / totalSpan` (0..1), then scaled to SVG coordinates with padding.

3. **Dots vs bars**: Events without `durationMs` render as circles (r=4). Events with `durationMs` render as rounded rectangles whose width is proportional to duration relative to total span. Minimum bar width is 2 SVG units.

4. **Auto-generated legend**: A flex-wrapped legend below the SVG shows unique event types with their color dots. Built from `Array.from(new Set(events.map(e => e.type)))`.

5. **Title elements for tooltips**: Each SVG element has a `<title>` child for native browser tooltips on hover.

## Pattern 3: useTraceRecorder Hook

**Provenance:** Verified 2026-03-15. Implemented at `packages/trace/src/hooks/useTraceRecorder.ts`.

### When to Use

When integrating TraceRecorder into a React component tree and feeding live events to TraceViewer/TraceTimeline.

### Return Interface

```typescript
export interface UseTraceRecorderReturn {
  recorder: TraceRecorder;           // Stable recorder instance
  events: TraceEvent[];              // Live-updating events array
  activeSession: TraceSession | null; // Currently active session (polled)
  isRecording: boolean;              // true when active session has no endedAt
}
```

### Key Design Decisions

1. **Stable recorder via useMemo + configRef**: The recorder is created once. Config changes are read via `configRef.current` — the recorder identity never changes, preventing re-render cascades.

2. **onEvent callback for live updates**: The hook injects its own `onEvent` into the recorder config that appends to the `events` state array. The user's `onEvent` (if provided) is also called via `configRef.current?.onEvent?.(event)`.

3. **Active session polling**: `setInterval` at 500ms polls `recorder.getActiveSession()`. This is lightweight (reads a Map entry) and avoids coupling the recorder to React's state system.

4. **isRecording derivation**: `activeSession !== null && activeSession.endedAt === undefined`. Simple boolean — no separate state.

### Usage with TraceViewer

```tsx
import { useTraceRecorder, TraceViewer, TracedAgentClient } from '@rickydata/trace';

function MyComponent({ client }: { client: AgentClient }) {
  const { recorder, events, isRecording } = useTraceRecorder();

  const traced = useMemo(() => new TracedAgentClient({
    client,
    // Share the recorder so events flow to the hook
    trace: { onEvent: (e) => recorder.record === recorder.record && undefined },
  }), [client]);

  // Better: pass the recorder directly
  // The useTraceRecorder hook's recorder already has onEvent wired up

  return (
    <div>
      <div>{isRecording ? 'Recording...' : 'Idle'}</div>
      <TraceViewer events={events} maxHeight="300px" />
    </div>
  );
}
```

## Pattern 4: Theme Token System

**Provenance:** Verified 2026-03-15. Implemented at `packages/trace/src/theme.ts`.

### When to Use

When customizing trace component appearance or creating light theme presets.

### Implementation

```typescript
// Dark theme tokens (default)
export const darkTokens: TraceThemeTokens = {
  '--trace-bg': '#0f0f0f',
  '--trace-bg-secondary': '#1a1a1a',
  '--trace-bg-hover': '#262626',
  '--trace-border': '#333333',
  '--trace-text': '#f5f5f5',
  '--trace-text-secondary': '#a3a3a3',
  '--trace-text-muted': '#737373',
  '--trace-font-family': 'system-ui, -apple-system, sans-serif',
  '--trace-font-size': '12px',
  '--trace-font-mono': "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  '--trace-radius': '4px',
  // ... event type colors
};

// Inject onto a DOM element
injectTraceTheme(containerRef.current, { ...darkTokens, ...userOverrides });
```

### Critical: Scoped to Container Element

Tokens are set as CSS custom properties on the container `<div>`, not on `:root`. This means multiple TraceViewer instances can have different themes on the same page. The `injectTraceTheme` function iterates `Object.entries(tokens)` and calls `element.style.setProperty(key, value)` for each.

### Namespace Convention

All trace tokens use the `--trace-*` prefix, mirroring the chat package's `--chat-*` prefix. When adding new tokens:
- Background variants: `--trace-bg-*`
- Text variants: `--trace-text-*`
- Event type colors: `--trace-color-{type}`

## Known Limitations

- No light theme preset is provided — only `darkTokens`. Create a custom `TraceThemeTokens` object for light mode.
- TraceTimeline SVG uses `preserveAspectRatio="none"` which can distort circles at extreme aspect ratios. The `height` prop mitigates this.
- useTraceRecorder polls active session at 500ms interval. This is a deliberate tradeoff — avoids coupling the recorder to React state while keeping UI reasonably responsive.
- TraceViewer auto-scrolls on every new event. There is no "scroll lock" to pause auto-scroll when the user is reading older events.
- Data summary truncation is fixed at 200 characters (`truncate(JSON.stringify(data), 200)`). Not configurable.
