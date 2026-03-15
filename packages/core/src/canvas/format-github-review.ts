/**
 * Format parsed review findings as a GitHub PR review payload.
 */

import type { ParsedReviewResult, ReviewFinding } from './parse-review-results.js';

export interface GitHubReviewComment {
  path: string;
  line?: number;
  side: 'RIGHT';
  body: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';
  comments: GitHubReviewComment[];
}

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\u{1F534}',  // 🔴
  major: '\u{1F7E0}',     // 🟠
  minor: '\u{1F7E1}',     // 🟡
  nit: '\u{1F535}',       // 🔵
  praise: '\u{1F49C}',    // 💜
};

function severityEmoji(severity: string): string {
  return SEVERITY_EMOJI[severity] ?? '';
}

function formatFindingBody(finding: ReviewFinding): string {
  let body = `${severityEmoji(finding.severity)} **${finding.severity.toUpperCase()}** — ${finding.title}\n\n`;
  body += finding.body;
  if (finding.suggestion) {
    body += `\n\n**Suggestion:**\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``;
  }
  return body;
}

/**
 * Format parsed review results as a GitHub PR review payload.
 */
export function formatGitHubReview(result: ParsedReviewResult): GitHubReviewPayload {
  const { findings, summary } = result;

  if (findings.length === 0) {
    return {
      body: summary || 'Review completed — no structured findings extracted.',
      event: 'COMMENT',
      comments: [],
    };
  }

  // Determine review event based on severity
  const hasCritical = findings.some(f => f.severity === 'critical');
  const hasMajor = findings.some(f => f.severity === 'major');
  const event: GitHubReviewPayload['event'] = hasCritical || hasMajor
    ? 'REQUEST_CHANGES'
    : 'COMMENT';

  // Build inline comments for findings with file + line
  const comments: GitHubReviewComment[] = [];
  const generalFindings: ReviewFinding[] = [];

  for (const finding of findings) {
    if (finding.file && finding.file !== 'N/A' && finding.file !== 'general') {
      comments.push({
        path: finding.file,
        line: finding.line,
        side: 'RIGHT',
        body: formatFindingBody(finding),
      });
    } else {
      generalFindings.push(finding);
    }
  }

  // Build summary body
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }

  let body = `## rickydata Team Review\n\n`;
  if (summary) {
    body += `${summary}\n\n`;
  }

  body += `### Findings (${findings.length})\n`;
  for (const [sev, count] of Object.entries(counts)) {
    body += `${severityEmoji(sev)} **${sev}**: ${count}  \n`;
  }

  // Add general findings (no file/line) to the body
  if (generalFindings.length > 0) {
    body += `\n### General\n`;
    for (const f of generalFindings) {
      body += `\n${formatFindingBody(f)}\n`;
    }
  }

  return { body, event, comments };
}
