export { AgentClient } from './agent-client.js';
export { AgentMCPClient } from './agent-mcp-client.js';
export { AgentSession } from './agent-session.js';
export { AgentBuilder, challengeVerifyToken } from './agent-builder.js';
export type { AgentBuilderConfig, DeployRecipeOptions } from './agent-builder.js';
export {
  parseAgentMarkdown,
  splitFrontMatter,
  parseFrontMatterBlock,
  toStringList,
} from './recipe.js';
export type { ParsedFrontMatter } from './recipe.js';
// SessionStore uses Node.js builtins (fs, path, os) — export from a
// separate entrypoint to avoid breaking browser bundlers.
// import { SessionStore } from 'rickydata/agent/node' for server usage.

// Error taxonomy
export { AgentError, AgentErrorCode, FREE_TIER_MODEL, FREE_TIER_ZAI_MODEL } from './types.js';

// Standalone SSE parsers & helpers
export {
  extractSSEData,
  streamSSEEvents,
  streamTeamSSEEvents,
  buildTeamWorkflowPayload,
} from './agent-client.js';

export type {
  // Image attachments (multimodal / screenshare)
  ImageAttachment,

  // Config
  AgentClientConfig,
  AgentInfo,
  AgentDetailResponse,
  CustomAgentDefinition,
  CustomAgentUpsertResult,

  // Agent Builder (recipe-driven provisioning)
  AgentSpec,
  AgentRecipe,
  SkillFile,
  CreateResult,
  VerifyResult,

  // Chat
  ChatOptions,
  ChatResult,
  ModelGuideSpecialistModel,
  ModelGuideSpecialistFile,
  ModelGuideSpecialistRequest,
  ModelGuideSpecialistEvent,
  ModelGuideSpecialistResult,
  ModelGuideSpecialistOptions,

  // Reflect
  ReflectConfig,
  ReflectStatus,
  KbToolsStatus,

  // SSE Events
  SSEEvent,
  SSETextEvent,
  SSEToolCallEvent,
  SSEToolResultEvent,
  SSEDoneEvent,
  SSEErrorEvent,
  SSEThinkingEvent,
  SSEPlanningEvent,
  SSEToolApprovalRequestEvent,
  SSETransactionSigningRequestEvent,

  // Sessions
  SessionCreateResponse,
  SessionListEntry,
  SessionDetail,

  // Secrets
  ServerRequirement,
  McpRequirementsResponse,
  AgentSecretStatus,
  CodexAuthStatus,

  // Wallet
  WalletSettings,
  WalletPlan,
  TeamExecutionEngine,
  MarketplaceProvider,
  ProviderApiKeyStatus,
  ProviderVaultUnlockResult,
  WalletSignMessage,
  FreeTierStatus,
  GroupConversationMeta,
  WalletBalanceResponse,
  WalletTransactionsResponse,

  // Voice
  VoiceTokenResponse,
  VoiceLivekitTokenResponse,
  VoiceLivekitTokenRequest,
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceEndResponse,

  // Team Workflow
  TeamWorkflowNode,
  TeamWorkflowConnection,
  TeamWorkflowTeammate,
  TeamWorkflowPayload,
  TeamSSEEventType,
  TeamSSEEvent,

  // Agent MCP Client
  AgentMCPClientConfig,
  MCPTool,
  MCPToolResult,
  MCPServerInfo,

  // Team Workflow Options
  TeamWorkflowOptions,

  // Error Taxonomy
  AgentErrorContext,

  // Connect Wizard
  ConnectWizardStep,
  TelegramConnectConfig,
} from './types.js';

export type { AgentSessionConfig, Message } from './agent-session.js';
