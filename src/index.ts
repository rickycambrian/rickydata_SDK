// Main client
export { MCPGateway } from './client.js';

// Auth
export { createWalletToken } from './auth.js';
export type { AuthenticateAutoOptions, EthHttpSigner } from './auth.js';

// Spending wallet
export { SpendingWallet } from './wallet/spending-wallet.js';
export { SpendingPolicy } from './wallet/spending-policy.js';

// Errors
export {
  MCPGatewayError,
  SpendingPolicyError,
  SpendingLimitExceededError,
  EndpointNotAllowedError,
  DuplicatePaymentError,
  CircuitBreakerTrippedError,
  PaymentSigningError,
} from './errors/index.js';

// Types
export type {
  GatewayConfig,
  SpendingWalletConfig,
  SpendingPolicyConfig,
  ApprovalDetails,
  Server,
  ServerDetail,
  Tool,
  ToolResult,
  ListOptions,
  PaymentConfig,
  PaymentRequirements,
  PaymentReceipt,
  SignedPayment,
  SpendingSummary,
  PolicyResult,
  PolicyViolationType,
  AuthSession,
  PaymentEvents,
} from './types/index.js';

// Agent Client (high-level chat helper)
export { AgentClient } from './agent/index.js';
export type {
  AgentClientConfig,
  AgentInfo,
  ChatOptions,
  ChatResult,
} from './agent/index.js';

// AgentSession facade (auth + session management in one)
export { AgentSession } from './agent/index.js';
export type {
  AgentSessionConfig,
  Message as AgentMessage,
} from './agent/index.js';

// Agent MCP Client (agent-as-MCP-server)
export { AgentMCPClient } from './agent/index.js';
export type {
  AgentMCPClientConfig,
  MCPTool,
  MCPToolResult,
  MCPServerInfo,
} from './agent/index.js';

// A2A Protocol Client
export { A2AClient, A2AError } from './a2a/index.js';
export type {
  A2AClientConfig,
  AgentCard,
  ExtendedAgentCard,
  AgentSkill,
  AgentProvider,
  AgentCapabilities,
  SecurityScheme,
  Message,
  Part,
  TextPart,
  FilePart,
  DataPart,
  Task,
  TaskCost,
  TaskState,
  TaskStatus,
  Artifact,
  SendMessageRequest,
  SendMessageConfiguration,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  StreamEvent,
  TaskListResponse,
  ListTasksOptions,
} from './a2a/index.js';
