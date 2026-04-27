// Main client
export { MCPGateway } from './client.js';
export { KFDBClient } from './kfdb/index.js';
export { ResearchClient, ResearchKFDBClient, SelfImprovementClient } from './research/index.js';

// Auth
export {
  AuthManager,
  createWalletToken,
  createSignToDeriveKey,
  createAuthenticatedClient,
  decodeTokenPayload,
  permissionMatches,
  getPermissions,
  hasPermission,
  AuthErrorCode,
} from './auth.js';
export type {
  AuthenticateAutoOptions,
  EthHttpSigner,
  DeriveKeyResponse,
  WalletTokenPayload,
  WalletTokenOptions,
  AuthenticatedClient,
} from './auth.js';

// Encryption utilities (sign-to-derive + AES-256-GCM client-side encryption)
export {
  deriveKeyFromSignature,
  deriveKeyFromSignatureLegacy,
  getDeriveKeyMessage,
  importKeyFromHex,
  encryptValue,
  decryptValue,
  encryptProperties,
  decryptResponseRows,
  isClientEncrypted,
} from './encryption.js';

// Spending wallet
export { SpendingWallet } from './wallet/spending-wallet.js';
export { SpendingPolicy } from './wallet/spending-policy.js';

// x402 HTTP client
export { X402Client } from './payment/x402-client.js';
export type { X402RequestOptions, X402Response } from './payment/x402-client.js';

// Errors
export {
  MCPGatewayError,
  SpendingPolicyError,
  SpendingLimitExceededError,
  EndpointNotAllowedError,
  DuplicatePaymentError,
  CircuitBreakerTrippedError,
  PaymentSigningError,
  CanvasHttpError,
  VaultError,
} from './errors/index.js';

// Types
export type {
  GatewayConfig,
  SpendingWalletConfig,
  SpendingPolicyConfig,
  ApprovalDetails,
  AttestationResult,
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
  SemanticSearchOptions,
  SemanticSearchResultItem,
  SemanticSearchResult,
  VaultSecretStatus,
  VaultSecretEntry,
} from './types/index.js';
export {
  MemoryDeriveSessionStore,
  FileDeriveSessionStore,
  buildAgentChatTraceOperations,
  createAgentChatTraceFixture,
  buildCodexHookTraceOperations,
  createCodexHookTraceFixture,
} from './kfdb/index.js';
export type {
  AgentChatTraceEvent,
  AgentChatTurnTrace,
  CodexHookEventRecord,
  CodexHookTrace,
  AutoDeriveOptions,
  DeriveChallenge,
  DeriveKeyResult,
  DeriveSession,
  DeriveSessionStore,
  KfdbBatchGetEntitiesRequest,
  KfdbBatchGetEntitiesResponse,
  KfdbClientConfig,
  KfdbEntityRef,
  KfdbEntityResponse,
  KfdbFilterEntitiesRequest,
  KfdbGetEntityOptions,
  KfdbLabelInfo,
  KfdbListEntitiesOptions,
  KfdbListEntitiesResponse,
  KfdbListLabelsResponse,
  KfdbQueryScope,
  KfdbWriteRequest,
  KfdbWriteResponse,
} from './kfdb/index.js';
export type {
  AppendResearchRunEventRequest,
  BacktestSkillCandidateRequest,
  CreateResearchIssueRequest,
  CreateResearchRunRequest,
  CreateSkillCandidateRequest,
  DismissResearchIssueRequest,
  DraftResearchIssueRequest,
  EvidenceGrade,
  FrictionSeverity,
  FrictionSourceType,
  HumanAIInteractionCard,
  IssueEscalation,
  IssueEscalationMode,
  IssueEscalationStatus,
  ProductFrictionFinding,
  PromotionDecision,
  PromoteResearchRunRequest,
  PromoteSkillCandidateRequest,
  PublicInputSnapshot,
  ResearchAgentCatalog,
  ResearchAgentCatalogEntry,
  ResearchAgentSpec,
  ResearchCandidate,
  ResearchClaim,
  ResearchClientConfig,
  ResearchEntityFilterOptions,
  ResearchEntityWriteRequest,
  ResearchEventType,
  ResearchGetEntityOptions,
  ResearchKFDBClientConfig,
  ResearchListEntityOptions,
  ResearchListIssuesOptions,
  ResearchListRunsOptions,
  ResearchNodeWriteRequest,
  ResearchPolicyArm,
  ResearchPrivacyContext,
  ResearchPrivacyQueryGuard,
  ResearchProvider,
  ResearchReadScope,
  ResearchRun,
  ResearchRunEvent,
  ResearchRunStatus,
  ResearchSnapshotWriteRequest,
  ResearchSqlValidationOptions,
  ResearchVerification,
  ResearchVerdict,
  ResearchVisibility,
  SanitizationStatus,
  SelfImprovementStatus,
  SkillBacktestResult,
  SkillBacktestVerdict,
  SkillCandidate,
  SkillCandidateListOptions,
  SkillCandidateStage,
  SkillEvidenceBundle,
  SkillTrigger,
  ToolFailureSignature,
  TraceEpisode,
  TriggerSelfImprovementRequest,
  VerifyResearchRunRequest,
  WalletSkillRecord,
} from './research/index.js';
export {
  DEFAULT_RESEARCH_AGENT_CATALOG,
  DEFAULT_RESEARCH_AGENT_SPECS,
  DEFAULT_RESEARCH_MODEL,
  DEFAULT_RESEARCH_PROVIDER,
  DOGFOOD_REFERENCE_AGENT_SPECS,
  createDefaultResearchPolicyArms,
} from './research/index.js';

// Agent Client (high-level chat helper)
export { AgentClient } from './agent/index.js';
// SessionStore removed from main export — uses Node.js builtins (fs, path, os)
// Use: import { SessionStore } from 'rickydata/agent/session-store' for server

// Agent Error Taxonomy
export { AgentError, AgentErrorCode } from './agent/index.js';
export type { AgentErrorContext } from './agent/index.js';

// Standalone SSE parsers & helpers
export {
  extractSSEData,
  streamSSEEvents,
  streamTeamSSEEvents,
  buildTeamWorkflowPayload,
} from './agent/index.js';

export type {
  // Image attachments (multimodal / screenshare)
  ImageAttachment,

  AgentClientConfig,
  AgentInfo,
  AgentDetailResponse,
  CustomAgentDefinition,
  CustomAgentUpsertResult,
  ChatOptions,
  ChatResult,
  TeamExecutionEngine,
  MarketplaceProvider,
  WalletPlan,
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
  WalletBalanceResponse,
  WalletTransactionsResponse,
  // Voice
  VoiceTokenResponse,
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceEndResponse,
  // Team Workflow
  TeamWorkflowNode,
  TeamWorkflowConnection,
  TeamWorkflowTeammate,
  TeamWorkflowPayload,
  TeamWorkflowOptions,
  TeamSSEEventType,
  TeamSSEEvent,
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
  // Connect Wizard
  ConnectWizardStep,
  TelegramConnectConfig,
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

// Canvas MCP Server
export { CanvasMCPServer, startCanvasMCPServer, createCanvasTools } from './mcp/index.js';
export type { CanvasMCPTool, MCPToolResponse } from './mcp/index.js';

// Agent MCP Proxy
export { AgentRegistry, AgentMCPProxy, startAgentMCPProxy } from './mcp/index.js';
export type { EnabledAgent, AgentRegistryFile } from './mcp/index.js';

// Canvas Workflow Client
export { CanvasClient } from './canvas/index.js';
export type {
  CanvasClientConfig,
  ExecuteWorkflowOptions,
  CanvasWorkflowJSON,
  CanvasNodeDefinition,
  CanvasEdgeDefinition,
  TextInputNodeData,
  AgentNodeData,
  MCPToolNodeData,
  ResultsNodeData,
  AgentTeamOrchestratorNodeData,
  AgentTeamTeammateNodeData,
  ApprovalGateNodeData,
  GitHubRepoNodeData,
  GitHubCreateBranchNodeData,
  GitHubCreateIssueNodeData,
  GitHubCommitFilesNodeData,
  GitHubOpenDraftPRNodeData,
  GitHubMarkPRReadyNodeData,
  BrowserVerifyNodeData,
  CanvasNodeData,
  CanvasNode,
  CanvasConnection,
  CanvasRuntimeMode,
  CanvasRuntimeOptions,
  CanvasTeamTeammateRuntime,
  CanvasTeamRuntimePayload,
  CanvasWorkflowRequest,
  CanvasRunStatusValue,
  CanvasNodeStatusValue,
  CanvasRunState,
  CanvasRunStartedEvent,
  CanvasNodeStartedEvent,
  CanvasNodeLogEvent,
  CanvasNodeCompletedEvent,
  CanvasNodeFailedEvent,
  CanvasApprovalRequiredEvent,
  CanvasApprovalResolvedEvent,
  CanvasTeamAgentEvent,
  CanvasTextEvent,
  CanvasRunCompletedEvent,
  CanvasRunFailedEvent,
  CanvasErrorEvent,
  CanvasSSEEvent,
  GeoWorkflow,
  CanvasExecutionResult,
} from './canvas/index.js';

// Canvas PR Review
export { buildPRReviewWorkflow, parseCanvasReviewResult, formatGitHubReview } from './canvas/index.js';
export type {
  PRReviewWorkflowInput,
  ReviewFinding,
  ParsedReviewResult,
  ParseFailureReason,
  ParseWarning,
  GitHubReviewPayload,
  GitHubReviewComment,
} from './canvas/index.js';

// Pixel Office Client
export { PixelClient, buildGitHubWorktreeWorkflow } from './pixel/index.js';
export type {
  PixelRuntimeKind,
  PixelActorKind,
  PixelActorStatus,
  PixelSessionDescriptor,
  PixelEvent,
  PixelSessionStartedEvent,
  PixelActorSpawnedEvent,
  PixelActorStatusEvent,
  PixelToolStartedEvent,
  PixelToolFinishedEvent,
  PixelApprovalRequiredEvent,
  PixelApprovalResolvedEvent,
  PixelTextDeltaEvent,
  PixelCostUpdatedEvent,
  PixelSessionWaitingEvent,
  PixelSessionCompletedEvent,
  PixelSessionFailedEvent,
  PixelClientConfig,
  CreatePixelAgentSessionRequest,
  StreamPixelAgentSessionRequest,
  PixelWorkflowRequest,
  PixelGitHubTeammate,
  PixelGitHubWorktreeRequest,
  PixelWalletStatus,
} from './pixel/index.js';

// Automation Client (event-driven LLM rules)
export { AutomationClient } from './automation/index.js';
export type {
  TriggerType,
  OperationType,
  LlmProvider,
  OutputStrategy,
  ExecutionStatus,
  TriggerFilters,
  AutomationRule,
  ExecutionLog,
  CreateRuleRequest,
  UpdateRuleRequest,
  RuleResponse,
  ListRulesResponse,
  RuleOperationResponse,
  ExecutionResponse,
  ExecutionLogsResponse,
  AutomationClientConfig,
} from './automation/index.js';

// Answer Sheet Client
export { AnswerSheetClient } from './answer-sheets/index.js';
export type {
  SolutionStep,
  ProblemCategory,
  MatchMethod,
  AnswerSheet,
  AnswerSheetSearchOptions,
  AnswerSheetSearchResult,
  CreateAnswerSheetRequest,
  CreateAnswerSheetResponse,
  UpdateAnswerSheetRequest,
  AnswerSheetMatch,
  MatchContext,
  MatchAnswerSheetRequest,
  MatchAnswerSheetResult,
  AnswerSheetFeedbackRequest,
  AnswerSheetFeedbackResult,
  AnswerSheetClientConfig,
} from './answer-sheets/index.js';

// ── Workspace ─────────────────────────────────────────────────────────────
export { WorkspaceClient } from './workspace/index.js';
export type {
  WorkspaceNote,
  NoteVersion,
  CreateNoteRequest,
  UpdateNoteRequest,
  ListNotesOptions,
  CheckEditsOptions,
  CheckEditsResult,
  WorkspaceClientConfig,
} from './workspace/index.js';

// Pipeline Client (autonomous issue resolution)
export { PipelineClient } from './pipeline/index.js';
export { MINIMAX_MODEL, GLM_MODEL } from './pipeline/index.js';
export type {
  PipelineProvider,
  PipelineExecutionEngine,
  PipelineResolveRequest,
  PipelineResolveResponse,
  PipelineResolveOptions,
  PipelineRouting,
  PipelineRunStatus,
  PipelineStatusResponse,
  PipelineROIDataStatus,
  PipelineOutcomeType,
  PipelineOutcomeReport,
  PipelineOutcomeResponse,
  PipelineROIUpdate,
  PipelineClientConfig,
  PlanStatus,
  PipelineProposeRequest,
  PipelineProposeResponse,
  PendingPlan,
} from './pipeline/index.js';

// Benchmark Client
export { BenchmarkClient } from './benchmarks/index.js';
export type {
  BenchmarkTask,
  BenchmarkRun,
  DiffQualityScore,
  CostMetrics,
  TestDeltaRecord,
  CreateTaskRequest,
  TaskSearchOptions,
  TaskListResult,
  RecordRunRequest,
  RunSearchOptions,
  RunListResult,
  ROIRecommendation,
  ROIQuery,
  ROIResult,
  CacheROIRequest,
  ConfigStatEntry,
  BenchmarkStats,
  PublishBenchmarkCampaignRequest,
  PublishBenchmarkCampaignResult,
  BenchmarkClientConfig,
} from './benchmarks/index.js';

// Geo Wallet (transaction detection & signing for Geo protocol APPROVAL mode)
export { detectGeoTransactionRequest, GeoTransactionSigner, resolveGeoWalletConfig } from './geo-wallet/index.js';
export type { PendingGeoTransaction, GeoTxResult, GeoTxSignerConfig, GeoWalletContext, GeoWalletConfigResult } from './geo-wallet/index.js';

// RPC Client (multi-chain JSON-RPC proxy)
export { RpcClient } from './rpc/rpc-client.js';
export type { ChainInfo, JsonRpcRequest, JsonRpcResponse } from './rpc/rpc-client.js';

// Cycle Client (autonomous loop tracking)
export { CycleClient } from './cycles/index.js';
export type {
  CycleClientConfig,
  CycleResult,
  CycleListResponse,
  CycleSummaryResponse,
  IngestCycleRequest,
  IngestCycleResponse,
} from './cycles/index.js';
