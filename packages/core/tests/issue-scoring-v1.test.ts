/**
 * issue-scoring-v1 contract tests — pins the DOCUMENTED DEVIATION: this label's
 * ids use HOME's uuidv5 namespace + day-keyed template, NOT deriveRickydataGraphId.
 * The expected uuids below were computed by rickydata_home's own
 * issueSnapshotNodeId (src/kfdb/issue-snapshots.ts) — if either side drifts,
 * ids stop merging against the 300+ live PRIVATE nodes and this fails.
 */
import { describe, expect, it } from 'vitest';
import {
  ISSUE_SCORING_SCHEMA,
  ISSUE_SCORING_KIND,
  ISSUE_SCORING_WRITER,
  ISSUE_SCORING_SCAN_KQL,
  issueScoreSnapshotDayId,
  issueScoreSnapshotId,
  decodeIssueScoreRows,
  latestIssueScores,
  topIssueCandidates,
} from '../src/kfdb/issue-scoring-v1.js';

describe('issue-scoring-v1 id derivation (home parity)', () => {
  it('matches home issueSnapshotNodeId byte-for-byte', () => {
    // Computed live from rickydata_home src/kfdb/issue-snapshots.ts on 2026-07-06.
    expect(issueScoreSnapshotId('rickycambrian/knowledgeflow_db', 291, '20260706')).toBe(
      '51ae4f6b-1ee7-5924-a660-b20996b660f3',
    );
    expect(issueScoreSnapshotId('owner/repo', 1, '20260101')).toBe(
      '32efcab1-89d7-53a9-a26d-2cc0e3ef579d',
    );
  });

  it('day id is UTC yyyymmdd', () => {
    expect(issueScoreSnapshotDayId(new Date('2026-07-06T23:59:59.000Z'))).toBe('20260706');
    expect(issueScoreSnapshotDayId(new Date('2026-07-06T00:00:00.000Z'))).toBe('20260706');
  });

  it('contract stamps', () => {
    expect(ISSUE_SCORING_SCHEMA).toBe('rickydata.repo_execution_graph.v1');
    expect(ISSUE_SCORING_KIND).toBe('issue_priority.v1');
    expect(ISSUE_SCORING_WRITER).toBe('rickydata_home/issue-scan');
    expect(ISSUE_SCORING_SCAN_KQL).toContain('PriorityScoreSnapshot');
  });
});

/** A raw row exactly as `RETURN n.*` returns it (tagged values), property names pinned. */
function rawRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: '51ae4f6b-1ee7-5924-a660-b20996b660f3',
    schema: { String: ISSUE_SCORING_SCHEMA },
    snapshot_kind: { String: ISSUE_SCORING_KIND },
    created_by: { String: ISSUE_SCORING_WRITER },
    repo_id: { String: 'knowledgeflow_db' },
    repo_full_name: { String: 'rickycambrian/knowledgeflow_db' },
    subject_id: { String: 'issue-291' },
    snapshot_id: { String: '20260706' },
    issue_number: { Integer: 291 },
    title: { String: 'ScyllaDB LocalQuorum failures' },
    html_url: { String: 'https://github.com/rickycambrian/knowledgeflow_db/issues/291' },
    labels_json: { String: '["P0-critical"]' },
    difficulty: { String: 'simple' },
    issue_type: { String: 'bug_fix' },
    language: { String: 'rust' },
    estimated_lines: { Integer: 20 },
    estimated_files: { Integer: 1 },
    confidence: { Float: 0.9 },
    tractability: { Float: 0.86 },
    readiness_score: { Float: 1.0 },
    readiness_status: { String: 'ready' },
    blockers_json: { String: '[]' },
    improvements_json: { String: '[{"action":"Add repro","impact":"high"}]' },
    signals_json: { String: '[{"name":"clarity","value":1,"status":"good","hint":null}]' },
    priority_rank: { Integer: 145 },
    root_issue_key: { String: 'rickycambrian/knowledgeflow_db.issue.scylladb-localquorum-failures' },
    dedup_key: { String: 'abcd1234abcd1234' },
    scanned_at: { String: '2026-07-06T10:00:00.000Z' },
    ...over,
  };
}

describe('decodeIssueScoreRows', () => {
  it('decodes a real tagged row and pins the property names', () => {
    const [row] = decodeIssueScoreRows([rawRow()]);
    expect(row).toBeDefined();
    expect(row!.nodeId).toBe('51ae4f6b-1ee7-5924-a660-b20996b660f3');
    expect(row!.repoFullName).toBe('rickycambrian/knowledgeflow_db');
    expect(row!.issueNumber).toBe(291);
    expect(row!.readinessStatus).toBe('ready');
    expect(row!.tractability).toBeCloseTo(0.86);
    expect(row!.priorityRank).toBe(145);
    expect(row!.labels).toEqual(['P0-critical']);
    expect(row!.improvements).toEqual([{ action: 'Add repro', impact: 'high' }]);
    expect(row!.signals[0]!.name).toBe('clarity');
  });

  it('skips rows from other writers/kinds (contract guard)', () => {
    expect(decodeIssueScoreRows([rawRow({ created_by: { String: 'someone-else' } })])).toHaveLength(0);
    expect(decodeIssueScoreRows([rawRow({ snapshot_kind: { String: 'other.v1' } })])).toHaveLength(0);
  });
});

describe('latestIssueScores / topIssueCandidates', () => {
  it('keeps the latest snapshot per issue and orders by priority rank', () => {
    const rows = decodeIssueScoreRows([
      rawRow({ snapshot_id: { String: '20260705' }, readiness_status: { String: 'needs_info' }, priority_rank: { Integer: 2500 } }),
      rawRow(), // same issue, later day, ready rank 145
      rawRow({ subject_id: { String: 'issue-5' }, issue_number: { Integer: 5 }, priority_rank: { Integer: 90 }, _id: 'x' }),
    ]);
    const latest = latestIssueScores(rows);
    expect(latest).toHaveLength(2);
    expect(latest[0]!.issueNumber).toBe(5);
    expect(latest[1]!.issueNumber).toBe(291);
    expect(latest[1]!.readinessStatus).toBe('ready'); // the later day won
  });

  it('top candidates = ready + tractability ≥ 0.6', () => {
    const rows = decodeIssueScoreRows([
      rawRow(),
      rawRow({ subject_id: { String: 'issue-7' }, issue_number: { Integer: 7 }, tractability: { Float: 0.3 }, _id: 'y' }),
      rawRow({ subject_id: { String: 'issue-8' }, issue_number: { Integer: 8 }, readiness_status: { String: 'marginal' }, _id: 'z' }),
    ]);
    const top = topIssueCandidates(rows);
    expect(top.map(r => r.issueNumber)).toEqual([291]);
  });
});
