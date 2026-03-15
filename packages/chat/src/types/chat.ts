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
