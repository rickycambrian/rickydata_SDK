import { describe, it, expect } from 'vitest';
import { parseCanvasReviewResult } from '../src/canvas/parse-review-results.js';
import type { ParseFailureReason } from '../src/canvas/parse-review-results.js';

describe('parseCanvasReviewResult', () => {
  // ─── Happy path: findings extracted successfully ────────

  it('extracts findings from result node output', () => {
    const result = parseCanvasReviewResult({
      results: {
        'results-1': JSON.stringify({
          findings: [
            { severity: 'major', category: 'security', file: 'src/app.ts', line: 10, title: 'SQL injection', body: 'Unescaped input' },
          ],
          summary: 'Found 1 issue',
        }),
      },
      events: [],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('major');
    expect(result.summary).toBe('Found 1 issue');
    expect(result.parseWarning).toBeUndefined();
  });

  it('extracts findings from team_agent_event completed messages', () => {
    const findingsJson = JSON.stringify({
      findings: [
        { severity: 'minor', category: 'style', file: 'src/utils.ts', title: 'Naming', body: 'Use camelCase' },
      ],
      summary: 'Style review',
    });

    const result = parseCanvasReviewResult({
      results: {},
      events: [
        {
          type: 'team_agent_event',
          data: {
            agentName: 'style',
            eventKind: 'agent_completed',
            message: findingsJson,
          },
        },
      ],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('style');
    expect(result.parseWarning).toBeUndefined();
  });

  it('prefers result nodes over SSE events', () => {
    const resultFindings = JSON.stringify({
      findings: [{ severity: 'critical', category: 'security', file: 'a.ts', title: 'A', body: 'From results' }],
    });
    const eventFindings = JSON.stringify({
      findings: [{ severity: 'minor', category: 'style', file: 'b.ts', title: 'B', body: 'From events' }],
    });

    const result = parseCanvasReviewResult({
      results: { 'results-1': resultFindings },
      events: [
        { type: 'team_agent_event', data: { eventKind: 'agent_completed', message: eventFindings } },
      ],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].body).toBe('From results');
  });

  // ─── Parse failure: no_agent_events ─────────────────────

  it('returns no_agent_events when stream has zero events and no results', () => {
    const result = parseCanvasReviewResult({
      results: {},
      events: [],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.parseWarning).toBeDefined();
    expect(result.parseWarning!.reason).toBe('no_agent_events' satisfies ParseFailureReason);
    expect(result.parseWarning!.message).toContain('zero team_agent_event');
  });

  // ─── Parse failure: events_but_no_json ──────────────────

  it('returns events_but_no_json when events contain no parseable JSON', () => {
    const result = parseCanvasReviewResult({
      results: {},
      events: [
        {
          type: 'team_agent_event',
          data: {
            agentName: 'security',
            eventKind: 'agent_completed',
            message: 'The review looks good overall. No structured output available.',
          },
        },
        {
          type: 'team_agent_event',
          data: {
            agentName: 'style',
            eventKind: 'agent_message',
            message: 'Checking code style...',
          },
        },
      ],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.parseWarning).toBeDefined();
    expect(result.parseWarning!.reason).toBe('events_but_no_json' satisfies ParseFailureReason);
    expect(result.parseWarning!.candidatesInspected).toBeGreaterThan(0);
  });

  // ─── Parse failure: json_but_no_findings_key ────────────

  it('returns json_but_no_findings_key when JSON has no findings array', () => {
    const jsonWithoutFindings = JSON.stringify({
      summary: 'Everything looks fine',
      score: 95,
    });

    const result = parseCanvasReviewResult({
      results: {},
      events: [
        {
          type: 'team_agent_event',
          data: {
            agentName: 'correctness',
            eventKind: 'agent_completed',
            message: jsonWithoutFindings,
          },
        },
      ],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.parseWarning).toBeDefined();
    expect(result.parseWarning!.reason).toBe('json_but_no_findings_key' satisfies ParseFailureReason);
  });

  // ─── Parse failure: findings_empty_array ────────────────

  it('returns findings_empty_array when findings key exists but is empty', () => {
    const emptyFindings = JSON.stringify({
      findings: [],
      summary: 'No issues found',
    });

    const result = parseCanvasReviewResult({
      results: {},
      events: [
        {
          type: 'team_agent_event',
          data: {
            agentName: 'architecture',
            eventKind: 'agent_completed',
            message: emptyFindings,
          },
        },
      ],
    });

    expect(result.findings).toHaveLength(0);
    expect(result.parseWarning).toBeDefined();
    expect(result.parseWarning!.reason).toBe('findings_empty_array' satisfies ParseFailureReason);
  });

  // ─── Parse warning metadata ─────────────────────────────

  it('includes candidate inspection metadata in parseWarning', () => {
    const result = parseCanvasReviewResult({
      results: { 'results-1': 'some non-JSON text that is long enough to be a candidate' },
      events: [
        {
          type: 'team_agent_event',
          data: {
            agentName: 'perf',
            eventKind: 'agent_message',
            message: 'Analyzing performance patterns in the diff...',
          },
        },
      ],
    });

    expect(result.parseWarning).toBeDefined();
    expect(result.parseWarning!.candidatesInspected).toBeGreaterThan(0);
    expect(result.parseWarning!.longestCandidateLength).toBeGreaterThan(0);
    expect(result.parseWarning!.message).toContain('parseCanvasReviewResult');
  });

  // ─── Regression: JSON in markdown fences ────────────────

  it('extracts findings from markdown code fences', () => {
    const markdown = '```json\n' + JSON.stringify({
      findings: [
        { severity: 'nit', category: 'style', file: 'src/index.ts', title: 'Trailing comma', body: 'Add trailing comma' },
      ],
      summary: 'Minor style issue',
    }) + '\n```';

    const result = parseCanvasReviewResult({
      results: { 'results-1': markdown },
      events: [],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('nit');
    expect(result.parseWarning).toBeUndefined();
  });

  it('handles findings from agent detail field', () => {
    const result = parseCanvasReviewResult({
      results: {},
      events: [
        {
          type: 'team_agent_event',
          data: {
            agentName: 'security',
            eventKind: 'agent_completed',
            message: '',
            detail: JSON.stringify({
              findings: [
                { severity: 'critical', category: 'security', file: 'auth.ts', title: 'Token leak', body: 'Token exposed' },
              ],
            }),
          },
        },
      ],
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe('Token leak');
  });
});
