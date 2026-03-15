export { CanvasClient } from './canvas-client.js';
export type { CanvasClientConfig } from './canvas-client.js';

export type {
  // Workflow JSON format
  CanvasWorkflowJSON,
  CanvasNodeDefinition,
  CanvasEdgeDefinition,

  // Node data types
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

  // Execution request
  CanvasNode,
  CanvasConnection,
  CanvasRuntimeMode,
  CanvasRuntimeOptions,
  CanvasTeamTeammateRuntime,
  CanvasTeamRuntimePayload,
  CanvasWorkflowRequest,

  // Run status
  CanvasRunStatusValue,
  CanvasNodeStatusValue,
  CanvasRunState,

  // SSE events
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

  // Geo workflow
  GeoWorkflow,

  // Execution result
  CanvasExecutionResult,
} from './types.js';

export { buildPRReviewWorkflow, type PRReviewWorkflowInput } from './pr-review-workflow.js';
