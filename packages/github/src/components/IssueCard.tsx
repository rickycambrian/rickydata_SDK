import type { GitHubIssue } from '../types.js';
import { ConfidenceBadge } from './ConfidenceBadge.js';
import { DifficultyBadge } from './DifficultyBadge.js';

interface IssueCardProps {
  issue: GitHubIssue;
  onResolve?: (issue: GitHubIssue) => void;
}

export function IssueCard({ issue, onResolve }: IssueCardProps) {
  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4 hover:border-primary-300 dark:hover:border-primary-700 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-surface-500 dark:text-surface-400">
              {issue.owner}/{issue.repo}#{issue.number}
            </span>
            {issue.difficulty && <DifficultyBadge difficulty={issue.difficulty} />}
            {issue.resolutionStatus && (
              <StatusBadge status={issue.resolutionStatus} />
            )}
          </div>
          <h3 className="font-medium text-surface-900 dark:text-surface-100 truncate">
            {issue.title}
          </h3>
          <div className="flex items-center gap-3 mt-2 text-sm text-surface-500 dark:text-surface-400">
            {issue.labels.map(l => (
              <span key={l} className="rounded bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 text-xs">
                {l}
              </span>
            ))}
            {issue.recommendedModel && (
              <span className="text-xs">Model: {issue.recommendedModel}</span>
            )}
            {issue.estimatedCost != null && (
              <span className="text-xs">${issue.estimatedCost.toFixed(3)}</span>
            )}
          </div>
        </div>
        {onResolve && issue.state === 'open' && (
          <button
            onClick={() => onResolve(issue)}
            className="shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
          >
            Resolve
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
    in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    auto_pr: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    queue_review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    merged: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    closed: 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full text-xs px-2 py-0.5 font-medium ${styles[status] || styles.pending}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
