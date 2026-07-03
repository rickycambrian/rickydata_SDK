import { describe, it, expect } from 'vitest';
import {
  parseIssueRef,
  buildBenchRunRequestBody,
  buildCandidateIngestBody,
} from '../../src/cli/commands/bench.js';

describe('parseIssueRef', () => {
  it('parses the canonical owner/repo#issue form', () => {
    expect(parseIssueRef('Textualize/rich#4038')).toEqual({
      repo: 'Textualize/rich',
      owner: 'Textualize',
      name: 'rich',
      issueNumber: 4038,
    });
  });

  it('tolerates a github.com host prefix', () => {
    expect(parseIssueRef('https://github.com/pallets/flask#5000')).toEqual({
      repo: 'pallets/flask',
      owner: 'pallets',
      name: 'flask',
      issueNumber: 5000,
    });
  });

  it('parses the /issues/ URL path shape', () => {
    expect(parseIssueRef('github.com/pallets/flask/issues/42')).toEqual({
      repo: 'pallets/flask',
      owner: 'pallets',
      name: 'flask',
      issueNumber: 42,
    });
  });

  it('accepts dots and dashes in repo names', () => {
    const parsed = parseIssueRef('my-org/repo.js#7');
    expect(parsed.repo).toBe('my-org/repo.js');
    expect(parsed.issueNumber).toBe(7);
  });

  it('rejects a missing issue number', () => {
    expect(() => parseIssueRef('Textualize/rich')).toThrow(/Invalid issue reference/);
  });

  it('rejects a zero / non-positive issue number', () => {
    expect(() => parseIssueRef('Textualize/rich#0')).toThrow();
  });

  it('rejects a missing owner', () => {
    expect(() => parseIssueRef('rich#12')).toThrow(/Invalid issue reference/);
  });
});

describe('buildBenchRunRequestBody', () => {
  it('emits the minimal run coordinates the stream endpoint expects', () => {
    const body = buildBenchRunRequestBody({
      repo: 'Textualize/rich',
      issueNumber: 4038,
      config: 'minimax-minimax-m3-claude-code-single',
      campaignId: 'benchmark_matrix_current',
    });
    expect(body).toEqual({
      repo: 'Textualize/rich',
      issue_number: 4038,
      config: 'minimax-minimax-m3-claude-code-single',
      campaign_id: 'benchmark_matrix_current',
    });
  });
});

describe('buildCandidateIngestBody', () => {
  it('requests a targeted single-issue ingest with fix-commit resolution', () => {
    const body = buildCandidateIngestBody({
      repo: 'pallets/flask',
      issueNumber: 5000,
      campaignId: 'benchmark_matrix_current',
    });
    expect(body).toMatchObject({
      repo: 'pallets/flask',
      issue_number: 5000,
      campaign_id: 'benchmark_matrix_current',
      refresh: true,
      resolve_fix_commits: true,
      publish_kfdb: true,
      include_all_closed_issues: false,
    });
  });
});
