/**
 * Agent Client Type Definitions
 *
 * Types for the high-level AgentClient that wraps the Agent Gateway API.
 */

// ─── Configuration ──────────────────────────────────────────

export interface AgentClientConfig {
  /** Private key for wallet-based authentication (0x-prefixed hex). Required unless `token` is provided. */
  privateKey?: string;
  /** Pre-existing auth token (wallet-token or JWT). Required unless `privateKey` is provided. */
  token?: string;
  /** Agent Gateway URL. Defaults to https://agents.rickydata.org */
  gatewayUrl?: string;
}

// ─── Agent ──────────────────────────────────────────────────

export interface AgentInfo {
  id: string;
  name: string;
  title: string;
  description: string;
  model: string;
  skillsCount: number;
}

// ─── Chat ───────────────────────────────────────────────────

export interface ChatOptions {
  /** Claude model to use. Defaults to 'haiku'. */
  model?: 'haiku' | 'sonnet' | 'opus';
  /** Reuse an existing session. Auto-creates one if omitted. */
  sessionId?: string;
  /** Called for each text chunk streamed from the agent. */
  onText?: (text: string) => void;
  /** Called when the agent invokes a tool. */
  onToolCall?: (tool: { name: string; displayName?: string; args: unknown }) => void;
  /** Called when a tool returns a result. */
  onToolResult?: (result: { name: string; result?: string; isError: boolean }) => void;
}

export interface ChatResult {
  /** Full accumulated text response. */
  text: string;
  /** Session ID (reuse for follow-up messages). */
  sessionId: string;
  /** Total cost in USDC display format (e.g. "$0.014"). */
  cost?: string;
  /** Number of MCP tool calls made. */
  toolCallCount?: number;
  /** Token usage. */
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── Reflect & KB Tools (Builder) ───────────────────────────

export interface ReflectConfig {
  minConfidence: number;
  autoShare: boolean;
  defaultSpace: string;
}

export interface ReflectStatus {
  reflectEnabled: boolean;
  reflectConfig: ReflectConfig;
  kbAuthConfigured: boolean;
}

export interface KbToolsStatus {
  kbToolsEnabled: boolean;
}

// ─── SSE Events (from Agent Gateway) ────────────────────────

export interface SSETextEvent {
  type: 'text';
  data: string;
}

export interface SSEToolCallEvent {
  type: 'tool_call';
  data: { name: string; displayName?: string; args: unknown; id?: string };
}

export interface SSEToolResultEvent {
  type: 'tool_result';
  data: { id?: string; name: string; isError: boolean; result?: string; content?: string };
}

export interface SSEDoneEvent {
  type: 'done';
  data: {
    cost?: string;
    costRaw?: string;
    balanceRemaining?: string;
    usage?: { inputTokens: number; outputTokens: number };
    toolCallCount?: number;
  };
}

export interface SSEErrorEvent {
  type: 'error';
  data: { code?: string; message: string };
}

export type SSEEvent = SSETextEvent | SSEToolCallEvent | SSEToolResultEvent | SSEDoneEvent | SSEErrorEvent;

// ─── Agent MCP Client ──────────────────────────────────────

export interface AgentMCPClientConfig {
  /** Agent Gateway URL. Defaults to https://agents.rickydata.org */
  baseUrl?: string;
  /** Private key for wallet-based authentication (0x-prefixed hex). */
  privateKey?: string;
  /** Pre-existing auth token (wallet-token or JWT). */
  token?: string;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export interface MCPServerInfo {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
}
