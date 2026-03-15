/**
 * Trace event and session types for @rickydata/trace.
 */

export interface TraceEvent {
  id: string;
  timestamp: string;
  type:
    | 'session_start'
    | 'session_end'
    | 'message_sent'
    | 'message_received'
    | 'tool_call'
    | 'tool_result'
    | 'sse_text'
    | 'sse_done'
    | 'error'
    | 'agent_action'
    | 'custom';
  sessionId?: string;
  agentId?: string;
  data: Record<string, unknown>;
  durationMs?: number;
}

export interface TraceSession {
  id: string;
  agentId: string;
  startedAt: string;
  endedAt?: string;
  events: TraceEvent[];
  metadata?: Record<string, unknown>;
}

export interface TraceRecorderConfig {
  /** Directory to write trace files. Default: ~/.claude/traces/ (Node.js only) */
  outputDir?: string;
  /** Output format. Default: jsonl */
  format?: 'jsonl' | 'json';
  /** Max file size in bytes before rotation. Default: 10MB */
  maxFileSize?: number;
  /** Enable/disable recording. Default: true */
  enabled?: boolean;
  /** Real-time callback for each recorded event */
  onEvent?: (event: TraceEvent) => void;
  /** Extra metadata attached to every session */
  sessionMetadata?: Record<string, unknown>;
}
