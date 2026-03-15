/** An action proposed by the agent for user confirmation. */
export interface ActionProposal {
  proposalId: string;
  actionType: string;
  description: string;
  params: Record<string, unknown>;
  status: 'pending' | 'completed' | 'rejected' | 'failed';
}

/** A UI element the agent wants to highlight. */
export interface HighlightTarget {
  target: string;
  tooltip?: string;
  durationMs?: number;
  delayMs?: number;
}
