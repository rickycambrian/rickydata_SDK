/**
 * Agent Client Type Definitions
 *
 * Types for the high-level AgentClient that wraps the Agent Gateway API.
 */

// ─── Configuration ──────────────────────────────────────────

export interface AgentClientConfig {
  /** Private key for wallet-based authentication (0x-prefixed hex). Required unless `token` or `tokenGetter` is provided. */
  privateKey?: string;
  /** Pre-existing auth token (wallet-token or JWT). Required unless `privateKey` or `tokenGetter` is provided. */
  token?: string;
  /** Async function that returns a token on demand (for browser/React use). */
  tokenGetter?: () => Promise<string | undefined>;
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

export interface CustomAgentDefinition {
  id: string;
  name: string;
  title?: string;
  description?: string;
  model?: string;
  category?: string;
  mcp_servers?: string[];
  builtin_tools?: string[];
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface CustomAgentUpsertResult {
  agentId: string;
  agentName?: string;
  qualityScore?: number;
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

// ─── Agent Detail ───────────────────────────────────────────

export interface AgentDetailResponse {
  id: string;
  name: string;
  title: string;
  description: string;
  model: string;
  tools: string[];
  toolsCount?: number;
  skills: Array<{ name: string; title: string; description: string }>;
  skillsCount?: number;
  categories?: string[];
  mcpServers?: string[];
  pricing?: {
    type: string;
    amount: string;
    currency: string;
    description: string;
  };
}

// ─── Sessions ───────────────────────────────────────────────

export interface SessionCreateResponse {
  id: string;
  agentId: string;
  model: string;
  createdAt: string;
}

export interface SessionListEntry {
  id: string;
  agentId: string;
  model: string;
  createdAt: string;
  lastActiveAt?: string;
  lastMessageAt?: string;
  messageCount?: number;
  preview?: string;
  persisted?: boolean;
}

export interface SessionDetail {
  id: string;
  agentId: string;
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
  }>;
  createdAt: string;
  lastActiveAt?: string;
}

// ─── Secrets ────────────────────────────────────────────────

export interface ServerRequirement {
  serverId: string;
  name: string;
  required: string[];
  optional?: string[];
  configured?: string[];
  missing?: string[];
}

export interface McpRequirementsResponse {
  agentId: string;
  servers: ServerRequirement[];
  totalRequired: number;
}

export interface AgentSecretStatus {
  configuredSecrets: string[];
  missingRequired: string[];
  ready: boolean;
}

// ─── Wallet ─────────────────────────────────────────────────

export interface WalletSettings {
  defaultModel?: string;
  persistConversations?: boolean;
  conversationRetentionDays?: number;
  favoriteAgentIds?: string[];
  [key: string]: unknown;
}

export interface WalletBalanceResponse {
  availableBalance: string;
  unifiedDepositAddress: string;
  agentSpends: Record<string, { totalSpent: string }>;
  depositInstructions?: {
    network?: string;
    chainId?: number;
    chainName?: string;
    token?: string;
    tokenAddress?: string;
    decimals?: number;
    minimumDeposit?: string;
    warning?: string;
  };
}

export interface WalletTransactionsResponse {
  transactions: Array<{
    id: string;
    type: string;
    amount: string;
    agentId?: string;
    timestamp: string;
  }>;
  total: number;
}

// ─── Voice ──────────────────────────────────────────────────

export interface VoiceTokenResponse {
  token: string;
  tools: number;
  toolDefinitions?: Array<{ type: string; name: string; description?: string; parameters?: unknown }>;
  model: string;
  voice: string;
}

export interface VoiceToolCallRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;
  sessionId?: string;
}

export interface VoiceToolCallResponse {
  callId: string;
  result: unknown;
  success: boolean;
}

export interface VoiceEndResponse {
  platformFee: string;
  platformFeeUsd: string;
  toolCallCount: number;
  durationMs: number;
}

// ─── Team Workflow ──────────────────────────────────────────

export interface TeamWorkflowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface TeamWorkflowConnection {
  source: string;
  target: string;
}

export interface TeamWorkflowTeammate {
  nodeId: string;
  teammateName: string;
  sourceType: 'standard' | 'marketplace';
  sourceAgentId?: string;
  rolePrompt?: string;
  model?: string;
}

export interface TeamWorkflowPayload {
  nodes: TeamWorkflowNode[];
  connections: TeamWorkflowConnection[];
  teamRuntime: {
    orchestratorNodeId: string;
    teammates: TeamWorkflowTeammate[];
  };
}

export type TeamSSEEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'team_agent_event'
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'done'
  | 'error';

export interface TeamSSEEvent {
  type: TeamSSEEventType;
  data: Record<string, unknown>;
}
