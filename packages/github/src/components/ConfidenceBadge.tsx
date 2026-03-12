interface ConfidenceBadgeProps {
  confidence: number;
  size?: 'sm' | 'md';
}

export function ConfidenceBadge({ confidence, size = 'md' }: ConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);
  let color: string;
  if (confidence >= 0.7) color = 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  else if (confidence >= 0.4) color = 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  else color = 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';

  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2 py-0.5';

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${color} ${sizeClass}`}>
      {pct}%
    </span>
  );
}
