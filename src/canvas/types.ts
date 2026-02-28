/**
 * Canvas Workflow Type Definitions
 *
 * Types for canvas workflow execution, node data, and SSE events
 * from the Agent Gateway canvas runtime.
 */

// ── Workflow JSON (portable file format) ─────────────────────────────────────

export interface CanvasWorkflowJSON {
  version: 1;
  name: string;
  description?: string;
  exportedAt: string;
  nodes: CanvasNodeDefinition[];
  edges: CanvasEdgeDefinition[];
}

export interface CanvasNodeDefinition {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface CanvasEdgeDefinition {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  type?: string;
  data?: Record<string, unknown>;
}

// ── Node Data Types ──────────────────────────────────────────────────────────

export interface TextInputNodeData {
  label?: string;
  value?: string;
  placeholder?: string;
  status?: 'idle' | 'running' | 'complete' | 'error';
}

export interface AgentNodeData {
  label?: string;
  sourceType?: 'standard' | 'marketplace';
  sourceAgentId?: string;
  model?: string;
  prompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
  allowedServers?: string[];
  status?: 'idle' | 'running' | 'complete' | 'error';
  result?: string;
  error?: string;
  durationMs?: number;
  teammateName?: string;
  tools?: string[];
}

export interface MCPToolNodeData {
  label?: string;
  toolName?: string;
  serverName?: string;
  serverId?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  gatewayVerified?: boolean;
  status?: 'idle' | 'running' | 'complete' | 'error';
}

export interface ResultsNodeData {
  label?: string;
  result?: string;
  logs?: string[];
  status?: 'idle' | 'running' | 'complete' | 'error';
  timestamp?: string;
  error?: string;
  durationMs?: number;
}

export interface AgentTeamOrchestratorNodeData {
  label?: string;
  teamName?: string;
  prompt?: string;
  model?: string;
  executionMode?: 'default' | 'github_worktree';
  defaultTeammatePresetRequest?: number;
  continueEnabled?: boolean;
  continueKey?: string;
  allowedServers?: string[];
  status?: string;
  result?: string;
  error?: string;
}

export interface AgentTeamTeammateNodeData {
  label?: string;
  teammateName?: string;
  sourceType?: 'standard' | 'marketplace';
  sourceAgentId?: string;
  rolePrompt?: string;
  model?: string;
  allowedServers?: string[];
  status?: string;
}

export interface ApprovalGateNodeData {
  label?: string;
  approvalId?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvalActionPending?: boolean;
  message?: string;
  status?: string;
}

export interface GitHubRepoNodeData {
  label?: string;
  owner?: string;
  repo?: string;
  repoFullName?: string;
  installationId?: number;
  repoId?: number;
  branch?: string;
  status?: string;
}

export interface GitHubCreateBranchNodeData {
  label?: string;
  branchName?: string;
  baseBranch?: string;
  status?: string;
}

export interface GitHubCreateIssueNodeData {
  label?: string;
  title?: string;
  body?: string;
  labels?: string;
  assignees?: string;
  status?: string;
}

export interface GitHubCommitFilesNodeData {
  label?: string;
  branch?: string;
  message?: string;
  filesJson?: string;
  consumeUpstream?: boolean;
  status?: string;
}

export interface GitHubOpenDraftPRNodeData {
  label?: string;
  head?: string;
  base?: string;
  title?: string;
  body?: string;
  consumeUpstream?: boolean;
  status?: string;
}

export interface GitHubMarkPRReadyNodeData {
  label?: string;
  prNumber?: number;
  ciPolicy?: 'strict' | 'warn';
  status?: string;
}

export interface BrowserVerifyNodeData {
  label?: string;
  serverId?: string;
  sessionConfigJson?: string;
  stepsJson?: string;
  assertionsJson?: string;
  timeoutMs?: number;
  status?: string;
}

export type CanvasNodeData =
  | TextInputNodeData
  | AgentNodeData
  | MCPToolNodeData
  | ResultsNodeData
  | AgentTeamOrchestratorNodeData
  | AgentTeamTeammateNodeData
  | ApprovalGateNodeData
  | GitHubRepoNodeData
  | GitHubCreateBranchNodeData
  | GitHubCreateIssueNodeData
  | GitHubCommitFilesNodeData
  | GitHubOpenDraftPRNodeData
  | GitHubMarkPRReadyNodeData
  | BrowserVerifyNodeData;

// ── Workflow Execution Request ───────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface CanvasConnection {
  source: string;
  target: string;
}

export type CanvasRuntimeMode = 'read_only' | 'write_candidate';

export interface CanvasRuntimeOptions {
  mode?: CanvasRuntimeMode;
  allowAgentFallback?: boolean;
  autoApprove?: boolean;
}

export interface CanvasTeamTeammateRuntime {
  nodeId: string;
  teammateName: string;
  sourceType: 'standard' | 'marketplace';
  sourceAgentId?: string;
  rolePrompt?: string;
  model?: string;
  allowedServers?: string[];
  tools?: string[];
  maxTurns?: number;
}

export interface CanvasTeamRuntimePayload {
  workflowId?: string;
  continue?: boolean;
  continueKey?: string;
  orchestratorNodeId?: string;
  teammates?: CanvasTeamTeammateRuntime[];
  workflowAllowedServers?: string[];
}

export interface CanvasWorkflowRequest {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  runtime?: CanvasRuntimeOptions;
  teamRuntime?: CanvasTeamRuntimePayload;
}

// ── Run Status ───────────────────────────────────────────────────────────────

export type CanvasRunStatusValue = 'created' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
export type CanvasNodeStatusValue = 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed';

export interface CanvasRunState {
  runId: string;
  walletAddress: string;
  status: CanvasRunStatusValue;
  runtime?: CanvasRuntimeOptions;
  nodeStatuses: Record<string, CanvasNodeStatusValue>;
  nodeResults: Record<string, unknown>;
  approvals: Array<{
    approvalId: string;
    nodeId: string;
    status: 'pending' | 'approved' | 'rejected';
    message: string;
    createdAt: string;
    resolvedAt?: string;
    reason?: string;
  }>;
  logs: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ── SSE Event Types ──────────────────────────────────────────────────────────

export interface CanvasRunStartedEvent {
  type: 'run_started';
  data: {
    runId: string;
    status: CanvasRunStatusValue;
    createdAt: string;
  };
}

export interface CanvasNodeStartedEvent {
  type: 'node_started';
  data: {
    runId: string;
    nodeId: string;
    nodeType: string;
    status: CanvasNodeStatusValue;
  };
}

export interface CanvasNodeLogEvent {
  type: 'node_log';
  data: {
    runId: string;
    nodeId?: string;
    nodeType?: string;
    message: string;
  };
}

export interface CanvasNodeCompletedEvent {
  type: 'node_completed';
  data: {
    runId: string;
    nodeId: string;
    nodeType: string;
    status: CanvasNodeStatusValue;
    result: unknown;
    durationMs?: number;
  };
}

export interface CanvasNodeFailedEvent {
  type: 'node_failed';
  data: {
    runId: string;
    nodeId: string;
    nodeType: string;
    upstreamNodeIds?: string[];
    error: string;
    stack?: string;
    durationMs?: number;
  };
}

export interface CanvasApprovalRequiredEvent {
  type: 'approval_required';
  data: {
    runId: string;
    approvalId: string;
    nodeId: string;
    message: string;
    status: 'pending';
    createdAt: string;
  };
}

export interface CanvasApprovalResolvedEvent {
  type: 'approval_resolved';
  data: {
    runId: string;
    approvalId: string;
    nodeId: string;
    decision: 'approve' | 'reject';
    reason?: string;
    resolvedAt: string;
  };
}

export interface CanvasTeamAgentEvent {
  type: 'team_agent_event';
  data: {
    runId: string;
    nodeId: string;
    agentName: string;
    eventKind: 'agent_started' | 'agent_message' | 'agent_tool_call' | 'agent_tool_result' | 'agent_completed';
    message?: string;
    detail?: unknown;
    timestamp: string;
  };
}

export interface CanvasTextEvent {
  type: 'text';
  data: string | { delta?: string };
}

export interface CanvasRunCompletedEvent {
  type: 'run_completed';
  data: {
    runId: string;
    status: CanvasRunStatusValue;
    results: Record<string, unknown>;
    logs: string[];
    completedAt: string;
  };
}

export interface CanvasRunFailedEvent {
  type: 'run_failed';
  data: {
    runId: string;
    status: CanvasRunStatusValue;
    error: string;
    logs: string[];
    failedAt: string;
  };
}

export interface CanvasErrorEvent {
  type: 'error';
  data: { code?: string; message: string };
}

export type CanvasSSEEvent =
  | CanvasRunStartedEvent
  | CanvasNodeStartedEvent
  | CanvasNodeLogEvent
  | CanvasNodeCompletedEvent
  | CanvasNodeFailedEvent
  | CanvasApprovalRequiredEvent
  | CanvasApprovalResolvedEvent
  | CanvasTeamAgentEvent
  | CanvasTextEvent
  | CanvasRunCompletedEvent
  | CanvasRunFailedEvent
  | CanvasErrorEvent;

// ── Geo Workflow (stored in Geo) ─────────────────────────────────────────────

export interface GeoWorkflow {
  entityId: string;
  name: string;
  description?: string;
  nodesJson: string;
  edgesJson: string;
  nodeCount: number;
  version: number;
  createdAt?: string;
  updatedAt?: string;
}

// ── Execution Result ─────────────────────────────────────────────────────────

export interface CanvasExecutionResult {
  runId: string;
  status: CanvasRunStatusValue;
  results: Record<string, unknown>;
  logs: string[];
  events: CanvasSSEEvent[];
}
