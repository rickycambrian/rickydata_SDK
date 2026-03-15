// Core recorder
export { TraceRecorder } from './recorder.js';

// Traced client wrapper
export { TracedAgentClient } from './traced-client.js';
export type { TracedAgentClientConfig } from './traced-client.js';

// Types
export type { TraceEvent, TraceSession, TraceRecorderConfig } from './types.js';

// Theme
export { darkTokens, injectTraceTheme } from './theme.js';
export type { TraceThemeTokens } from './theme.js';

// React hook
export { useTraceRecorder } from './hooks/useTraceRecorder.js';
export type { UseTraceRecorderReturn } from './hooks/useTraceRecorder.js';

// React components
export { TraceViewer } from './components/TraceViewer.js';
export type { TraceViewerProps } from './components/TraceViewer.js';
export { TraceTimeline } from './components/TraceTimeline.js';
export type { TraceTimelineProps } from './components/TraceTimeline.js';

// Utilities
export { generateId, formatTimestamp, isNode } from './utils.js';
