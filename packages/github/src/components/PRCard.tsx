import type { PullRequest } from '../types.js';

interface PRCardProps {
  pr: PullRequest;
  onMerge?: (pr: PullRequest) => void;
  onClose?: (pr: PullRequest) => void;
}

export function PRCard({ pr, onMerge, onClose }: PRCardProps) {
  const ciColors: Record<string, string> = {
    passing: 'text-green-600 dark:text-green-400',
    failing: 'text-red-600 dark:text-red-400',
    pending: 'text-yellow-600 dark:text-yellow-400',
    unknown: 'text-surface-500',
  };

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm text-surface-500 dark:text-surface-400">
              {pr.owner}/{pr.repo}#{pr.number}
            </span>
            <span className={`text-xs font-medium ${ciColors[pr.ciStatus]}`}>
              CI: {pr.ciStatus}
            </span>
          </div>
          <h3 className="font-medium text-surface-900 dark:text-surface-100 truncate">{pr.title}</h3>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">{pr.branch}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {pr.state === 'open' && onMerge && (
            <button
              onClick={() => onMerge(pr)}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
            >
              Merge
            </button>
          )}
          {pr.state === 'open' && onClose && (
            <button
              onClick={() => onClose(pr)}
              className="rounded-lg border border-surface-300 dark:border-surface-600 px-3 py-1.5 text-sm font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
