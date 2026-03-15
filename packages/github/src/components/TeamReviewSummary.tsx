import type { TeamReviewRun, FindingSeverity } from '../types.js';

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: 'text-red-600 dark:text-red-400',
  major: 'text-orange-600 dark:text-orange-400',
  minor: 'text-yellow-600 dark:text-yellow-400',
  nit: 'text-blue-600 dark:text-blue-400',
  praise: 'text-purple-600 dark:text-purple-400',
};

interface TeamReviewSummaryProps {
  run: TeamReviewRun;
  onPost?: () => void;
}

export function TeamReviewSummary({ run, onPost }: TeamReviewSummaryProps) {
  const teamData = run.teamReview;
  if (!teamData) return null;

  const { stats } = teamData;
  const hasCritical = (stats.bySeverity.critical ?? 0) > 0;
  const hasMajor = (stats.bySeverity.major ?? 0) > 0;

  const recommendation = hasCritical
    ? 'REQUEST_CHANGES'
    : hasMajor
      ? 'COMMENT'
      : 'APPROVE';

  const badgeClass = recommendation === 'APPROVE'
    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    : recommendation === 'REQUEST_CHANGES'
      ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-200 dark:border-surface-700 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>
            {recommendation.replace('_', ' ')}
          </span>
          <span className="text-sm text-surface-500 dark:text-surface-400">
            {stats.totalFindings} findings from {teamData.agents.length} agents
          </span>
        </div>
        {teamData.totalCost && (
          <span className="text-xs text-surface-400">{teamData.totalCost}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {Object.entries(stats.bySeverity).map(([severity, count]) => (
          <div key={severity} className="flex items-center gap-1 text-sm">
            <span className={`font-semibold ${SEVERITY_COLORS[severity as FindingSeverity]}`}>
              {count}
            </span>
            <span className="text-surface-500 capitalize">{severity}</span>
          </div>
        ))}
      </div>

      {teamData.agents.map((agent) => (
        agent.summary && (
          <div key={agent.agentRole} className="text-xs text-surface-600 dark:text-surface-400">
            <span className="font-medium capitalize">{agent.agentRole.replace('_', ' ')}</span>: {agent.summary}
          </div>
        )
      ))}

      {onPost && run.status === 'completed' && (
        <button
          onClick={onPost}
          className="mt-1 self-start rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          Post Review to GitHub
        </button>
      )}
    </div>
  );
}
