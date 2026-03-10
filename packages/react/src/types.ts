/** Chat message as used in React UI state. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  toolExecutions?: ToolExecution[];
  timestamp: string;
  costUSD?: string;
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
