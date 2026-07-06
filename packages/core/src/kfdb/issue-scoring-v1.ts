/**
 * kfdb/issue-scoring-v1.ts — the typed READER for `PriorityScoreSnapshot`
 * (contract `rickydata.repo_execution_graph.v1`, payload `issue_priority.v1`).
 *
 * rickydata_home's issue-scoring pass (SPEC-013/014) is the SOLE WRITER of
 * these nodes: gateway scan + readiness → one PRIVATE snapshot per issue per
 * scan day, S2D-encrypted in the canonical wallet keyspace. This module gives
 * every sibling app (git_website, code, canvas tools) the same decode +
 * triage-ordering logic home uses, WITHOUT opening a second write path.
 *
 * ID DERIVATION — DOCUMENTED DEVIATION. The graph contract reserves
 * PriorityScoreSnapshot with `deriveRickydataGraphId(kind, [repo_id,
 * subject_id, snapshot_id])`, but home shipped (and live data carries) its own
 * app-local derivation — uuidv5 over HOME's namespace of
 * `PriorityScoreSnapshot:<repo_full_name>:issue-<n>:<yyyymmdd>` — and ids are
 * MERGE KEYS on 300+ live nodes. Same precedent as mission-control's app-local
 * ids: this module adopts HOME's derivation as canonical for this label.
 * `issueScoreSnapshotId` below is the one true derivation; do NOT use
 * `deriveRickydataGraphId` for this label.
 */
import { createHash } from 'node:crypto';

export const ISSUE_SCORING_SCHEMA = 'rickydata.repo_execution_graph.v1';
export const ISSUE_SCORING_KIND = 'issue_priority.v1';
export const ISSUE_SCORING_WRITER = 'rickydata_home/issue-scan';
export const ISSUE_SCORING_LABEL = 'PriorityScoreSnapshot';

/** rickydata_home's fixed uuidv5 namespace (src/hitl/ids.ts HOME_NAMESPACE). */
export const HOME_ISSUE_SCORING_NAMESPACE = '6f3a1e2c-9b47-5d8a-bc11-7e0f2a9d4c63';

/** The private-scope label scan every reader starts from (decode with decodeIssueScoreRows). */
export const ISSUE_SCORING_SCAN_KQL = 'MATCH (n:PriorityScoreSnapshot) RETURN n.* LIMIT 2000';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
  return (
    h.slice(0, 4).join('') +
    '-' +
    h.slice(4, 6).join('') +
    '-' +
    h.slice(6, 8).join('') +
    '-' +
    h.slice(8, 10).join('') +
    '-' +
    h.slice(10, 16).join('')
  );
}

/** RFC 4122 v5 (SHA-1) UUID over home's namespace — byte-identical to home's uuidv5. */
function uuidv5Home(name: string): string {
  const ns = hexToBytes(HOME_ISSUE_SCORING_NAMESPACE);
  const data = Buffer.concat([Buffer.from(ns), Buffer.from(name, 'utf8')]);
  const hash = createHash('sha1').update(data).digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/** UTC yyyymmdd snapshot id — scan-day identity must not depend on TZ. */
export function issueScoreSnapshotDayId(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * The canonical PriorityScoreSnapshot node id (HOME's derivation — see the
 * module doc's deviation note). Plain `:` separators by design.
 */
export function issueScoreSnapshotId(repoFullName: string, issueNumber: number, dayId: string): string {
  return uuidv5Home(`${ISSUE_SCORING_LABEL}:${repoFullName}:issue-${issueNumber}:${dayId}`);
}

/** One decoded snapshot row (mirror of home's IssueSnapshotRow). */
export interface IssueScoreSnapshotRow {
  nodeId: string;
  repoFullName: string;
  repoId: string;
  subjectId: string;
  snapshotId: string;
  issueNumber: number;
  title: string;
  htmlUrl: string;
  labels: string[];
  difficulty: string;
  issueType: string;
  language: string;
  estimatedLines: number;
  estimatedFiles: number;
  confidence: number;
  tractability: number;
  readinessScore: number;
  readinessStatus: string; // ready | marginal | needs_info | unscored
  blockers: string[];
  improvements: Array<{ action: string; impact: string }>;
  signals: Array<{ name: string; value: number; status: string; hint: string | null }>;
  priorityRank: number;
  rootIssueKey: string;
  dedupKey: string;
  scannedAt: string;
}

// --- read-side value unwrap (KQL tagged values → JS; encrypted blobs dropped) --

const ENC_PREFIX = '__enc_';

function unwrap(value: unknown): string | number | boolean | undefined {
  if (value == null || value === 'Null') return undefined;
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('String' in v) {
      const s = v['String'];
      return typeof s === 'string' && s.startsWith(ENC_PREFIX) ? undefined : (s as string);
    }
    if ('Integer' in v) return v['Integer'] as number;
    if ('Float' in v) return v['Float'] as number;
    if ('Boolean' in v) return v['Boolean'] as boolean;
    return undefined;
  }
  if (typeof value === 'string') return value.startsWith(ENC_PREFIX) ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

function str(row: Record<string, unknown>, key: string, fallback = ''): string {
  const u = unwrap(row[key]);
  return typeof u === 'string' ? u : fallback;
}

function num(row: Record<string, unknown>, key: string, fallback = 0): number {
  const u = unwrap(row[key]);
  return typeof u === 'number' ? u : fallback;
}

/**
 * Decode raw `RETURN n.*` rows into typed snapshot rows. Rows that are not
 * home-written issue snapshots (wrong created_by / snapshot_kind) are skipped —
 * the label scan is the query; this filter is the contract guard.
 */
export function decodeIssueScoreRows(rawRows: Array<Record<string, unknown>>): IssueScoreSnapshotRow[] {
  const out: IssueScoreSnapshotRow[] = [];
  for (const raw of rawRows) {
    if (str(raw, 'created_by') !== ISSUE_SCORING_WRITER) continue;
    if (str(raw, 'snapshot_kind') !== ISSUE_SCORING_KIND) continue;
    const parse = <T>(key: string, fallback: T): T => {
      try {
        return JSON.parse(str(raw, key) || '') as T;
      } catch {
        return fallback;
      }
    };
    out.push({
      nodeId: str(raw, '_id'),
      repoFullName: str(raw, 'repo_full_name'),
      repoId: str(raw, 'repo_id'),
      subjectId: str(raw, 'subject_id'),
      snapshotId: str(raw, 'snapshot_id'),
      issueNumber: num(raw, 'issue_number'),
      title: str(raw, 'title'),
      htmlUrl: str(raw, 'html_url'),
      labels: parse<string[]>('labels_json', []),
      difficulty: str(raw, 'difficulty'),
      issueType: str(raw, 'issue_type'),
      language: str(raw, 'language'),
      estimatedLines: num(raw, 'estimated_lines'),
      estimatedFiles: num(raw, 'estimated_files'),
      confidence: num(raw, 'confidence'),
      tractability: num(raw, 'tractability'),
      readinessScore: num(raw, 'readiness_score'),
      readinessStatus: str(raw, 'readiness_status'),
      blockers: parse<string[]>('blockers_json', []),
      improvements: parse<Array<{ action: string; impact: string }>>('improvements_json', []),
      signals: parse<Array<{ name: string; value: number; status: string; hint: string | null }>>(
        'signals_json',
        [],
      ),
      priorityRank: num(raw, 'priority_rank'),
      rootIssueKey: str(raw, 'root_issue_key'),
      dedupKey: str(raw, 'dedup_key'),
      scannedAt: str(raw, 'scanned_at'),
    });
  }
  return out;
}

export interface IssueScoreFilters {
  /** Matches repo_id OR repo_full_name (case-insensitive). */
  repo?: string;
  difficulty?: string;
  readinessStatus?: string;
  limit?: number;
}

/**
 * The triage list: LATEST snapshot per issue (max snapshot_id wins), filtered,
 * deterministic priority_rank ASC (work-this-first) — identical ordering to
 * home's `GET /api/issues/scored`.
 */
export function latestIssueScores(
  rows: IssueScoreSnapshotRow[],
  filters: IssueScoreFilters = {},
): IssueScoreSnapshotRow[] {
  const latest = new Map<string, IssueScoreSnapshotRow>();
  for (const row of rows) {
    const key = `${row.repoFullName}#${row.issueNumber}`;
    const kept = latest.get(key);
    if (!kept || row.snapshotId > kept.snapshotId) latest.set(key, row);
  }
  let out = [...latest.values()];
  if (filters.repo) {
    const want = filters.repo.toLowerCase();
    out = out.filter(r => r.repoId.toLowerCase() === want || r.repoFullName.toLowerCase() === want);
  }
  if (filters.difficulty) out = out.filter(r => r.difficulty === filters.difficulty);
  if (filters.readinessStatus) out = out.filter(r => r.readinessStatus === filters.readinessStatus);
  out.sort((a, b) => a.priorityRank - b.priorityRank || a.issueNumber - b.issueNumber);
  return out.slice(0, Math.max(1, filters.limit ?? 200));
}

/** Top candidates (kf_github_dev TOP_CANDIDATES): ready + high tractability. */
export function topIssueCandidates(rows: IssueScoreSnapshotRow[], limit = 10): IssueScoreSnapshotRow[] {
  return latestIssueScores(rows, { limit: 10_000 })
    .filter(r => r.readinessStatus === 'ready' && r.tractability >= 0.6)
    .slice(0, Math.max(1, limit));
}
