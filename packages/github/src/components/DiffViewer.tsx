interface DiffViewerProps {
  diff: string;
  maxHeight?: string;
}

export function DiffViewer({ diff, maxHeight = '400px' }: DiffViewerProps) {
  const lines = diff.split('\n');

  return (
    <div className="rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
      <div className="bg-surface-50 dark:bg-surface-900 px-3 py-1.5 border-b border-surface-200 dark:border-surface-700">
        <span className="text-xs font-medium text-surface-600 dark:text-surface-400">Diff</span>
      </div>
      <pre
        className="overflow-auto text-xs font-mono p-3 bg-white dark:bg-surface-950"
        style={{ maxHeight }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith('+') && !line.startsWith('+++')
                ? 'bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300'
                : line.startsWith('-') && !line.startsWith('---')
                ? 'bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300'
                : line.startsWith('@@')
                ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-300'
                : 'text-surface-700 dark:text-surface-300'
            }
          >
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}
