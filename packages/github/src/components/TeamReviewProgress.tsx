import type { TeamReviewRun, TeamReviewRunEvent, TeamReviewAgentRole } from '../types.js';

const AGENT_LABELS: Record<TeamReviewAgentRole, string> = {
  security: 'Security',
  correctness: 'Correctness',
  performance: 'Performance',
  test_coverage: 'Test Coverage',
  style: 'Style',
  architecture: 'Architecture',
};

const AGENT_ICONS: Record<TeamReviewAgentRole, string> = {
  security: '\u{1F6E1}',
  correctness: '\u2713',
  performance: '\u26A1',
  test_coverage: '\u{1F9EA}',
  style: '\u{1F3A8}',
  architecture: '\u{1F3D7}',
};

interface TeamReviewProgressProps {
  run?: TeamReviewRun;
  events?: TeamReviewRunEvent[];
  compact?: boolean;
}

export function TeamReviewProgress({ run, events = [], compact = false }: TeamReviewProgressProps) {
  const agentStatuses: Partial<Record<TeamReviewAgentRole, 'pending' | 'running' | 'completed' | 'failed'>> = {};
  const agentFindingCounts: Partial<Record<TeamReviewAgentRole, number>> = {};

  for (const event of events) {
    if (!event.agentRole) continue;
    if (event.eventKind === 'agent_started') agentStatuses[event.agentRole] = 'running';
    if (event.eventKind === 'agent_completed') agentStatuses[event.agentRole] = 'completed';
    if (event.eventKind === 'agent_failed') agentStatuses[event.agentRole] = 'failed';
    if (event.eventKind === 'agent_finding') {
      agentFindingCounts[event.agentRole] = (agentFindingCounts[event.agentRole] ?? 0) + 1;
    }
  }

  const allRoles: TeamReviewAgentRole[] = run?.teamReview?.config.agents ?? [
    'security', 'correctness', 'performance', 'test_coverage', 'style', 'architecture',
  ];

  const statusBadge = (status?: string) => {
    switch (status) {
      case 'running':
        return <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />;
      case 'completed':
        return <span className="inline-block h-2 w-2 rounded-full bg-green-500" />;
      case 'failed':
        return <span className="inline-block h-2 w-2 rounded-full bg-red-500" />;
      default:
        return <span className="inline-block h-2 w-2 rounded-full bg-surface-300 dark:bg-surface-600" />;
    }
  };

  return (
    <div className={compact ? 'flex flex-wrap gap-2' : 'flex flex-col gap-1'}>
      {compact ? (
        allRoles.map((role) => (
          <div key={role} className="flex items-center gap-1 rounded bg-surface-100 dark:bg-surface-800 px-2 py-1 text-xs">
            {statusBadge(agentStatuses[role])}
            <span>{AGENT_LABELS[role]}</span>
            {(agentFindingCounts[role] ?? 0) > 0 && (
              <span className="text-surface-500">{agentFindingCounts[role]}</span>
            )}
          </div>
        ))
      ) : (
        allRoles.map((role) => (
          <div key={role} className="flex items-center gap-2 text-sm">
            {statusBadge(agentStatuses[role])}
            <span className="w-5 text-center">{AGENT_ICONS[role]}</span>
            <span className="w-28 font-medium">{AGENT_LABELS[role]}</span>
            <span className="text-surface-500 dark:text-surface-400 text-xs">
              {agentFindingCounts[role] ?? 0} findings
            </span>
          </div>
        ))
      )}
      {run?.teamReview?.totalCost && (
        <div className="mt-1 text-xs text-surface-500 dark:text-surface-400">
          Cost: {run.teamReview.totalCost}
        </div>
      )}
    </div>
  );
}
