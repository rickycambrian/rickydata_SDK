import type { ActionProposal } from './actions.js';

export interface AgentTargetDescriptor {
  id: string;
  label: string;
  description?: string;
  role?: string;
  visible?: boolean;
}

export interface AgentHostContextSnapshot {
  route: string;
  view: string;
  title?: string;
  entityId?: string;
  selection?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  visibleTargets?: AgentTargetDescriptor[];
}

export interface AgentActionRequest extends ActionProposal {
  targetId?: string;
}

export interface AgentActionResult {
  proposalId: string;
  status: 'completed' | 'rejected' | 'failed';
  message?: string;
  revalidateKeys?: string[];
  data?: Record<string, unknown>;
}

export interface AgentHostAdapter {
  getContextSnapshot: () => AgentHostContextSnapshot;
  executeAction?: (request: AgentActionRequest) => Promise<AgentActionResult>;
  navigate?: (path: string) => void;
  scrollToTarget?: (targetId: string) => void;
  scrollToAnchor?: (anchorId: string, behavior?: ScrollBehavior) => void;
  openPanel?: (panel: string) => void;
}
