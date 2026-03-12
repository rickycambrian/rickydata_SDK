import type { GitHubInstallation } from '../types.js';

interface InstallationCardProps {
  installation: GitHubInstallation;
  onToggleKillSwitch?: (id: string, enabled: boolean) => void;
  onChangeTier?: (id: string, tier: GitHubInstallation['trustTier']) => void;
}

export function InstallationCard({ installation, onToggleKillSwitch, onChangeTier }: InstallationCardProps) {
  const tierColors: Record<string, string> = {
    sandbox: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    standard: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    trusted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  };

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-medium text-surface-900 dark:text-surface-100">{installation.owner}</h3>
          <p className="text-sm text-surface-500 dark:text-surface-400">
            {installation.repos.length} repos
          </p>
        </div>
        <span className={`rounded-full text-xs px-2 py-0.5 font-medium ${tierColors[installation.trustTier]}`}>
          {installation.trustTier}
        </span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-surface-600 dark:text-surface-400">Kill Switch</span>
          <button
            onClick={() => onToggleKillSwitch?.(installation.id, !installation.killSwitch)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              installation.killSwitch ? 'bg-red-500' : 'bg-surface-300 dark:bg-surface-600'
            }`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
              installation.killSwitch ? 'translate-x-4.5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
        {onChangeTier && (
          <select
            value={installation.trustTier}
            onChange={e => onChangeTier(installation.id, e.target.value as GitHubInstallation['trustTier'])}
            className="rounded border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-2 py-1 text-xs"
          >
            <option value="sandbox">Sandbox</option>
            <option value="standard">Standard</option>
            <option value="trusted">Trusted</option>
          </select>
        )}
      </div>

      {installation.stats && (
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          <div className="rounded bg-surface-50 dark:bg-surface-800 p-2">
            <div className="text-lg font-semibold">{installation.stats.totalResolved}</div>
            <div className="text-xs text-surface-500">Resolved</div>
          </div>
          <div className="rounded bg-surface-50 dark:bg-surface-800 p-2">
            <div className="text-lg font-semibold">{(installation.stats.successRate * 100).toFixed(0)}%</div>
            <div className="text-xs text-surface-500">Success</div>
          </div>
          <div className="rounded bg-surface-50 dark:bg-surface-800 p-2">
            <div className="text-lg font-semibold">{installation.stats.avgResolutionTime}s</div>
            <div className="text-xs text-surface-500">Avg Time</div>
          </div>
        </div>
      )}
    </div>
  );
}
