import { describe, it, expect } from 'vitest';
import { formatGitHubReview } from '../src/canvas/format-github-review.js';
import type { ParsedReviewResult, ReviewFinding } from '../src/canvas/parse-review-results.js';

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: 'minor',
    category: 'style',
    file: 'src/app.ts',
    line: 10,
    title: 'Test finding',
    body: 'Test body',
    ...overrides,
  };
}

function makeResult(
  findings: ReviewFinding[],
  summary = 'Test summary',
): ParsedReviewResult {
  return { findings, summary, rawOutput: '' };
}

describe('formatGitHubReview', () => {
  // ─── Empty findings ──────────────────────────────────────

  it('produces a summary-only review when findings are empty', () => {
    const payload = formatGitHubReview(makeResult([], 'All clear'));

    expect(payload.event).toBe('COMMENT');
    expect(payload.comments).toHaveLength(0);
    expect(payload.body).toBe('All clear');
  });

  it('uses default message when findings and summary are both empty', () => {
    const payload = formatGitHubReview(makeResult([], ''));

    expect(payload.body).toBe('Review completed — no structured findings extracted.');
    expect(payload.comments).toHaveLength(0);
  });

  // ─── Severity → event mapping ────────────────────────────

  it('returns REQUEST_CHANGES for critical severity', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ severity: 'critical' })]),
    );
    expect(payload.event).toBe('REQUEST_CHANGES');
  });

  it('returns REQUEST_CHANGES for major severity', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ severity: 'major' })]),
    );
    expect(payload.event).toBe('REQUEST_CHANGES');
  });

  it('returns COMMENT for minor severity', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ severity: 'minor' })]),
    );
    expect(payload.event).toBe('COMMENT');
  });

  it('returns COMMENT for nit severity', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ severity: 'nit' })]),
    );
    expect(payload.event).toBe('COMMENT');
  });

  it('returns COMMENT for praise severity', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ severity: 'praise' })]),
    );
    expect(payload.event).toBe('COMMENT');
  });

  // ─── Severity emoji in comment body ──────────────────────

  it.each([
    ['critical', '\u{1F534}'],
    ['major', '\u{1F7E0}'],
    ['minor', '\u{1F7E1}'],
    ['nit', '\u{1F535}'],
    ['praise', '\u{1F49C}'],
  ] as const)('includes %s emoji in comment body', (severity, emoji) => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ severity })]),
    );
    expect(payload.comments[0].body).toContain(emoji);
    expect(payload.comments[0].body).toContain(severity.toUpperCase());
  });

  // ─── Inline comments structure ───────────────────────────

  it('creates inline comments with correct fields', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ file: 'src/index.ts', line: 42, title: 'Bug', body: 'Details' })]),
    );

    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0].path).toBe('src/index.ts');
    expect(payload.comments[0].line).toBe(42);
    expect(payload.comments[0].side).toBe('RIGHT');
    expect(payload.comments[0].body).toContain('Bug');
    expect(payload.comments[0].body).toContain('Details');
  });

  // ─── Multiple findings from the same file ────────────────

  it('creates separate comments for findings in the same file', () => {
    const payload = formatGitHubReview(
      makeResult([
        makeFinding({ file: 'src/app.ts', line: 5, title: 'Issue A' }),
        makeFinding({ file: 'src/app.ts', line: 20, title: 'Issue B' }),
      ]),
    );

    expect(payload.comments).toHaveLength(2);
    expect(payload.comments[0].path).toBe('src/app.ts');
    expect(payload.comments[1].path).toBe('src/app.ts');
  });

  // ─── Findings without line numbers ───────────────────────

  it('produces valid comments for findings without line numbers', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ file: 'src/utils.ts', line: undefined })]),
    );

    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0].path).toBe('src/utils.ts');
    expect(payload.comments[0].line).toBeUndefined();
  });

  // ─── General findings (no file) go into body ─────────────

  it('puts findings without a file into the body instead of comments', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ file: 'general', title: 'General issue' })]),
    );

    expect(payload.comments).toHaveLength(0);
    expect(payload.body).toContain('General issue');
  });

  it('puts findings with file "N/A" into the body', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ file: 'N/A', title: 'N/A issue' })]),
    );

    expect(payload.comments).toHaveLength(0);
    expect(payload.body).toContain('N/A issue');
  });

  // ─── Suggestion rendering ────────────────────────────────

  it('includes suggestion code block in comment body', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ suggestion: 'const x = 1;' })]),
    );

    expect(payload.comments[0].body).toContain('**Suggestion:**');
    expect(payload.comments[0].body).toContain('```suggestion');
    expect(payload.comments[0].body).toContain('const x = 1;');
  });

  it('omits suggestion block when suggestion is absent', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding({ suggestion: undefined })]),
    );

    expect(payload.comments[0].body).not.toContain('Suggestion');
  });

  // ─── Summary body includes counts ────────────────────────

  it('includes severity counts in the summary body', () => {
    const payload = formatGitHubReview(
      makeResult([
        makeFinding({ severity: 'critical' }),
        makeFinding({ severity: 'minor', file: 'b.ts' }),
        makeFinding({ severity: 'minor', file: 'c.ts' }),
      ]),
    );

    expect(payload.body).toContain('rickydata Team Review');
    expect(payload.body).toContain('Findings (3)');
    expect(payload.body).toContain('**critical**: 1');
    expect(payload.body).toContain('**minor**: 2');
  });

  it('includes the summary text in the body', () => {
    const payload = formatGitHubReview(
      makeResult([makeFinding()], 'Overall looks good'),
    );

    expect(payload.body).toContain('Overall looks good');
  });
});
