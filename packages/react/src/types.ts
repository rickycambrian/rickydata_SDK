/** Image attached to a chat message. */
export interface ChatImage {
  data: string;
  mediaType: string;
  preview: string;
}

/** Chat message as used in React UI state. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  toolExecutions?: ToolExecution[];
  thinking?: string;
  timestamp: string;
  costUSD?: string;
  images?: ChatImage[];
}

/** A tool call + optional result within a chat message. */
export interface ToolExecution {
  id: string;
  name: string;
  displayName?: string;
  args: unknown;
  result?: { content?: string; isError: boolean };
}

/** Section of missing secrets to configure. */
export interface SecretSection {
  id: string;
  label: string;
  keys: string[];
  configuredKeys: string[];
  save: (secrets: Record<string, string>) => Promise<void>;
}

// ─── Voice Types ─────────────────────────────────────────

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected';

export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'using_tools' | 'speaking';

export interface VoiceTranscript {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: string;
  isFinal: boolean;
  isNarration?: boolean;
}

export interface VoiceToolCallInfo {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'executing' | 'completed' | 'error' | 'timed_out';
  timestamp?: number;
}
