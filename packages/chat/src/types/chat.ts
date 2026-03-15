/** Tool call + optional result within a chat message. */
export interface ToolExecution {
  id: string;
  name: string;
  displayName: string;
  args: unknown;
  result?: {
    content: string;
    isError: boolean;
  };
}

/** A message in the chat bubble UI. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source?: 'text' | 'voice' | 'system';
  created_at?: string;
  toolExecutions?: ToolExecution[];
  costUSD?: string;
}

/**
 * Generic chat context — apps define their own context types
 * by extending this shape.
 */
export interface ChatContext {
  type: string;
  refId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

/** External engine interface — apps provide their own chat state machine. */
export interface ChatEngine {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  sendMessage: () => Promise<void>;
  isContextual: boolean;
  // Optional features
  sessionId?: string | null;
  streamingPhase?: 'idle' | 'tools' | 'streaming';
  activeTools?: string[];
  abort?: () => void;
}
