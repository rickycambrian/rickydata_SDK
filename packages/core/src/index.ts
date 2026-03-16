// Main client
export { MCPGateway } from './client.js';

// Auth
export { AuthManager, createWalletToken } from './auth.js';
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
  CanvasHttpError,
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
export { SessionStore } from './agent/index.js';

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
  AgentClientConfig,
  AgentInfo,
  AgentDetailResponse,
  CustomAgentDefinition,
  CustomAgentUpsertResult,
  ChatOptions,
  ChatResult,
  // Sessions
  SessionCreateResponse,
  SessionListEntry,
  SessionDetail,
  // Secrets
  ServerRequirement,
  McpRequirementsResponse,
  AgentSecretStatus,
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

// Pipeline Client (autonomous issue resolution)
export { PipelineClient } from './pipeline/index.js';
export type {
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
  BenchmarkClientConfig,
} from './benchmarks/index.js';

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
