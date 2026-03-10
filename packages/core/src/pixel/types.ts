import type {
  CanvasConnection,
  CanvasNode,
  CanvasRunState,
  CanvasRuntimeOptions,
  CanvasTeamRuntimePayload,
} from '../canvas/types.js';

export type PixelRuntimeKind = 'agent_session' | 'canvas_workflow';
export type PixelActorKind = 'agent' | 'orchestrator' | 'teammate' | 'github_workflow';
export type PixelActorStatus =
  | 'idle'
  | 'thinking'
  | 'running_tool'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed';

export interface PixelSessionDescriptor {
  sessionId: string;
  actorId: string;
  actorKind: PixelActorKind;
  actorName: string;
  agentId?: string;
  createdAt: string;
  resumed?: boolean;
}

export interface PixelActorStatusEvent {
  type: 'actor_status';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    status: PixelActorStatus;
    label?: string;
    detail?: string;
    reasonCode?: string;
  };
}

export interface PixelSessionStartedEvent {
  type: 'session_started';
  data: {
    sessionId: string;
    runId?: string;
    runtime: PixelRuntimeKind;
    actorId: string;
    actorName: string;
    actorKind: PixelActorKind;
    createdAt: string;
    agentId?: string;
  };
}

export interface PixelActorSpawnedEvent {
  type: 'actor_spawned';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    actorName: string;
    actorKind: PixelActorKind;
    parentActorId?: string;
    agentId?: string;
    repoFullName?: string;
  };
}

export interface PixelToolStartedEvent {
  type: 'tool_started';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    toolId: string;
    toolName: string;
    displayName?: string;
    input?: unknown;
  };
}

export interface PixelToolFinishedEvent {
  type: 'tool_finished';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    toolId: string;
    toolName: string;
    output?: unknown;
    isError?: boolean;
  };
}

export interface PixelApprovalRequiredEvent {
  type: 'approval_required';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    approvalId: string;
    message: string;
    nodeId?: string;
  };
}

export interface PixelApprovalResolvedEvent {
  type: 'approval_resolved';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    approvalId: string;
    decision: 'approve' | 'reject';
    reason?: string;
    nodeId?: string;
  };
}

export interface PixelTextDeltaEvent {
  type: 'text_delta';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    delta: string;
  };
}

export interface PixelCostUpdatedEvent {
  type: 'cost_updated';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
    cost: string;
    costRaw: string;
    balance?: string;
    balanceRemaining?: string;
    toolCallCount?: number;
    model?: string;
  };
}

export interface PixelSessionWaitingEvent {
  type: 'session_waiting';
  data: {
    sessionId: string;
    runId?: string;
    actorId: string;
  };
}

export interface PixelSessionCompletedEvent {
  type: 'session_completed';
  data: {
    sessionId: string;
    runId?: string;
    actorId?: string;
    results?: unknown;
    logs?: string[];
    completedAt: string;
  };
}

export interface PixelSessionFailedEvent {
  type: 'session_failed';
  data: {
    sessionId: string;
    runId?: string;
    actorId?: string;
    code?: string;
    message: string;
    recoverable?: boolean;
    failedAt: string;
  };
}

export type PixelEvent =
  | PixelSessionStartedEvent
  | PixelActorSpawnedEvent
  | PixelActorStatusEvent
  | PixelToolStartedEvent
  | PixelToolFinishedEvent
  | PixelApprovalRequiredEvent
  | PixelApprovalResolvedEvent
  | PixelTextDeltaEvent
  | PixelCostUpdatedEvent
  | PixelSessionWaitingEvent
  | PixelSessionCompletedEvent
  | PixelSessionFailedEvent;

export interface PixelClientConfig {
  baseUrl?: string;
  auth: import('../auth.js').AuthManager;
}

export interface CreatePixelAgentSessionRequest {
  model?: string;
  resumeSessionId?: string;
}

export interface StreamPixelAgentSessionRequest {
  message: string;
  model?: string;
  maxToolRounds?: number;
}

export interface PixelWorkflowRequest {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  userPrompt?: string;
  runtime?: CanvasRuntimeOptions;
  teamRuntime?: CanvasTeamRuntimePayload;
}

export interface PixelGitHubTeammate {
  nodeId?: string;
  teammateName: string;
  sourceType?: 'standard' | 'marketplace';
  sourceAgentId?: string;
  rolePrompt?: string;
  model?: string;
  allowedServers?: string[];
  tools?: string[];
  maxTurns?: number;
}

export interface PixelGitHubWorktreeRequest {
  repoFullName: string;
  prompt: string;
  baseBranch?: string;
  branchName?: string;
  branchPrefix?: string;
  teamName?: string;
  teammates?: PixelGitHubTeammate[];
  runtime?: CanvasRuntimeOptions;
  openPullRequest?: boolean;
}

export interface PixelWalletStatus {
  balance: {
    availableBalance?: string;
    depositAddress?: string;
    [key: string]: unknown;
  };
  byok: {
    configured: boolean;
  };
}

export type { CanvasRunState };
