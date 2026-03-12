import { usePipelineStatus } from '../hooks/usePipelineStatus.js';

export function PipelineStatusBar() {
  const { data, isLoading } = usePipelineStatus();

  if (isLoading || !data) return null;

  const statusColors: Record<string, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500',
    down: 'bg-red-500',
  };

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-surface-100 dark:bg-surface-800 text-sm">
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${statusColors[data.overall]}`} />
        <span className="font-medium capitalize">{data.overall}</span>
      </div>
      {Object.entries(data).filter(([k]) => k !== 'overall').map(([name, comp]) => {
        const c = comp as { status: string };
        return (
          <div key={name} className="flex items-center gap-1 text-xs text-surface-500 dark:text-surface-400">
            <div className={`w-1.5 h-1.5 rounded-full ${statusColors[c.status]}`} />
            {name}
          </div>
        );
      })}
    </div>
  );
}
