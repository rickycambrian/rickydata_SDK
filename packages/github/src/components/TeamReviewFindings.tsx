import { useMemo } from 'react';
import type { TeamReviewFinding, FindingSeverity, TeamReviewAgentRole } from '../types.js';

const SEVERITY_COLORS: Record<FindingSeverity, string> = {
  critical: 'bg-red-500',
  major: 'bg-orange-500',
  minor: 'bg-yellow-500',
  nit: 'bg-blue-400',
  praise: 'bg-purple-500',
};

const SEVERITY_TEXT: Record<FindingSeverity, string> = {
  critical: 'text-red-700 dark:text-red-400',
  major: 'text-orange-700 dark:text-orange-400',
  minor: 'text-yellow-700 dark:text-yellow-400',
  nit: 'text-blue-700 dark:text-blue-400',
  praise: 'text-purple-700 dark:text-purple-400',
};

const AGENT_LABELS: Record<TeamReviewAgentRole, string> = {
  security: 'Security',
  correctness: 'Correctness',
  performance: 'Performance',
  test_coverage: 'Test Coverage',
  style: 'Style',
  architecture: 'Architecture',
};

interface TeamReviewFindingsProps {
  findings: TeamReviewFinding[];
  groupBy?: 'file' | 'severity' | 'agent' | 'category';
  onFindingClick?: (finding: TeamReviewFinding) => void;
}

export function TeamReviewFindings({ findings, groupBy = 'severity', onFindingClick }: TeamReviewFindingsProps) {
  const grouped = useMemo(() => {
    const groups: Record<string, TeamReviewFinding[]> = {};
    for (const finding of findings) {
      let key: string;
      switch (groupBy) {
        case 'file': key = finding.file; break;
        case 'severity': key = finding.severity; break;
        case 'agent': key = finding.agentRole; break;
        case 'category': key = finding.category; break;
      }
      (groups[key] ??= []).push(finding);
    }
    return groups;
  }, [findings, groupBy]);

  if (findings.length === 0) {
    return <div className="text-sm text-surface-500 dark:text-surface-400">No findings</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(grouped).map(([group, items]) => (
        <div key={group}>
          <h4 className="mb-2 text-sm font-semibold text-surface-700 dark:text-surface-300 capitalize">
            {groupBy === 'agent' ? AGENT_LABELS[group as TeamReviewAgentRole] ?? group : group}
            <span className="ml-1 text-surface-400">({items.length})</span>
          </h4>
          <div className="flex flex-col gap-2">
            {items.map((finding) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => onFindingClick?.(finding)}
                className="flex flex-col gap-1 rounded-lg border border-surface-200 dark:border-surface-700 p-3 text-left hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${SEVERITY_COLORS[finding.severity]}`} />
                  <span className={`text-xs font-medium uppercase ${SEVERITY_TEXT[finding.severity]}`}>
                    {finding.severity}
                  </span>
                  <span className="text-xs text-surface-400">
                    {AGENT_LABELS[finding.agentRole]}
                  </span>
                  {finding.confidence < 0.7 && (
                    <span className="text-xs text-surface-400">
                      ({Math.round(finding.confidence * 100)}% confidence)
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-surface-900 dark:text-surface-100">
                  {finding.title}
                </div>
                <div className="text-xs text-surface-500 dark:text-surface-400">
                  {finding.file}{finding.line ? `:${finding.line}` : ''}
                  {finding.endLine ? `-${finding.endLine}` : ''}
                </div>
                <div className="text-sm text-surface-600 dark:text-surface-300 line-clamp-2">
                  {finding.body}
                </div>
                {finding.suggestion && (
                  <pre className="mt-1 rounded bg-surface-100 dark:bg-surface-800 p-2 text-xs font-mono overflow-x-auto">
                    {finding.suggestion}
                  </pre>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
