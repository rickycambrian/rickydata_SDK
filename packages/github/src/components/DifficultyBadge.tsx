interface DifficultyBadgeProps {
  difficulty: 'simple' | 'medium' | 'complex';
}

export function DifficultyBadge({ difficulty }: DifficultyBadgeProps) {
  const styles: Record<string, string> = {
    simple: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    medium: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    complex: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  };

  return (
    <span className={`inline-flex items-center rounded-full text-xs px-2 py-0.5 font-medium ${styles[difficulty]}`}>
      {difficulty}
    </span>
  );
}
