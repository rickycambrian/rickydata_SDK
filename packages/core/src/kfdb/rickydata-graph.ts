import { createHash } from 'node:crypto';

export const RICKYDATA_GRAPH_NAMESPACE = '2f3e8ab8-8684-5c6a-9fd2-c5467b94251d';
export const RICKYDATA_GRAPH_SCHEMA_VERSION = 'rickydata.repo_execution_graph.v1';

export enum GraphEntityKind {
  Repository = 'Repository',
  Commit = 'Commit',
  File = 'File',
  Function = 'Function',
  TypeDefinition = 'TypeDefinition',
  TestCase = 'TestCase',
  Symbol = 'Symbol',
  Dependency = 'Dependency',
  GitHubIssue = 'GitHubIssue',
  GitHubProjectItem = 'GitHubProjectItem',
  GitHubPullRequest = 'GitHubPullRequest',
  RickydataWorkIntent = 'RickydataWorkIntent',
  RickydataAttempt = 'RickydataAttempt',
  RickydataRun = 'RickydataRun',
  RickydataPatch = 'RickydataPatch',
  RickydataProof = 'RickydataProof',
  CIJob = 'CIJob',
  AgentSession = 'AgentSession',
  AgentTraceEvent = 'AgentTraceEvent',
  RelaySnapshot = 'RelaySnapshot',
  KfdbProjection = 'KfdbProjection',
  UnderstandingSummary = 'UnderstandingSummary',
  CodeConcept = 'CodeConcept',
  DesignDecision = 'DesignDecision',
  RickydataProductEntity = 'RickydataProductEntity',
  RoadmapItem = 'RoadmapItem',
  EvidenceRecord = 'EvidenceRecord',
  PriorityScoreSnapshot = 'PriorityScoreSnapshot',
  AlignmentReviewItem = 'AlignmentReviewItem',
  DecisionRecord = 'DecisionRecord',
  RoadmapSnapshot = 'RoadmapSnapshot',
  AgentContextPack = 'AgentContextPack',
  EvidenceRequirement = 'EvidenceRequirement',
  EvidenceBundle = 'EvidenceBundle',
  ReleaseGate = 'ReleaseGate',
  LearningItem = 'LearningItem',
  BenchmarkRunProof = 'BenchmarkRunProof',
  /**
   * memory-v1 (`rickydata.memory.v1`): an open/clarification question the system
   * should ask a human. The ONE new label the memory contract adds; see
   * `knowledgeflow_db/specs/MEMORY_V1_SPEC.md` and `./memory-v1.ts`.
   */
  OpenQuestion = 'OpenQuestion',
}

export enum GraphEdgeType {
  Contains = 'CONTAINS',
  HasCommit = 'HAS_COMMIT',
  Defines = 'DEFINES',
  Imports = 'IMPORTS',
  Calls = 'CALLS',
  Tests = 'TESTS',
  DependsOn = 'DEPENDS_ON',
  Touches = 'TOUCHES',
  Mentions = 'MENTIONS',
  Implements = 'IMPLEMENTS',
  DerivedFromIssue = 'DERIVED_FROM_ISSUE',
  ProducedBy = 'PRODUCED_BY',
  Proves = 'PROVES',
  FailedBy = 'FAILED_BY',
  Supersedes = 'SUPERSEDES',
  Blocks = 'BLOCKS',
  Unblocks = 'UNBLOCKS',
  SupportedBy = 'SUPPORTED_BY',
  VerifiedBy = 'VERIFIED_BY',
  ProjectedToKfdb = 'PROJECTED_TO_KFDB',
  SyncedToRelay = 'SYNCED_TO_RELAY',
  Summarizes = 'SUMMARIZES',
  AboutProductEntity = 'ABOUT_PRODUCT_ENTITY',
  RequiresEvidence = 'REQUIRES_EVIDENCE',
  SatisfiesRequirement = 'SATISFIES_REQUIREMENT',
  BundlesEvidence = 'BUNDLES_EVIDENCE',
  CapturesPriority = 'CAPTURES_PRIORITY',
  ReviewedForAlignment = 'REVIEWED_FOR_ALIGNMENT',
  RecordsDecision = 'RECORDS_DECISION',
  SnapshotsRoadmap = 'SNAPSHOTS_ROADMAP',
  ProvidesContext = 'PROVIDES_CONTEXT',
  GatesRelease = 'GATES_RELEASE',
  CapturesLearning = 'CAPTURES_LEARNING',
  SatisfiesWorkIntent = 'SATISFIES_WORK_INTENT',
  ProvenByBenchmark = 'PROVEN_BY_BENCHMARK',
  GeneratedBySession = 'GENERATED_BY_SESSION',
}

export type RickydataGraphPrimitiveValue =
  | { String: string }
  | { Integer: number }
  | { Float: number }
  | { Boolean: boolean }
  | { Array: RickydataGraphPrimitiveValue[] }
  | { Object: Record<string, RickydataGraphPrimitiveValue> }
  | { Null: null };

export interface RickydataGraphContract {
  schemaVersion: string;
  nodeLabels: string[];
  edgeTypes: string[];
  idConventions: Record<GraphEntityKind, string[]>;
}

export interface RickydataGraphNode {
  kind: GraphEntityKind;
  idParts: Array<string | number>;
  properties?: Record<string, RickydataGraphPrimitiveValue>;
}

export interface RickydataGraphEdge {
  from: string;
  to: string;
  edgeType: GraphEdgeType;
  properties?: Record<string, RickydataGraphPrimitiveValue>;
}

export interface RickydataGraphWriteInput {
  nodes?: RickydataGraphNode[];
  edges?: RickydataGraphEdge[];
}

export type RickydataGraphWriteOperation =
  | {
      operation: 'create_node';
      id: string;
      label: string;
      properties: Record<string, RickydataGraphPrimitiveValue>;
      mode: 'merge';
    }
  | {
      operation: 'create_edge';
      id: string;
      from: string;
      to: string;
      edge_type: string;
      properties: Record<string, RickydataGraphPrimitiveValue>;
    };

export interface RickydataGraphWriteRequest {
  operations: RickydataGraphWriteOperation[];
  skip_embedding: true;
}

const ENTITY_ID_PARTS: Record<GraphEntityKind, string[]> = {
  [GraphEntityKind.Repository]: ['canonical_repo_ref'],
  [GraphEntityKind.Commit]: ['repo_id', 'commit_sha'],
  [GraphEntityKind.File]: ['repo_id', 'commit_sha', 'path', 'content_hash'],
  [GraphEntityKind.Function]: ['file_id', 'function_name', 'span_hash'],
  [GraphEntityKind.TypeDefinition]: ['file_id', 'type_name', 'span_hash'],
  [GraphEntityKind.TestCase]: ['file_id', 'test_name', 'span_hash'],
  [GraphEntityKind.Symbol]: ['repo_id', 'commit_sha', 'path', 'symbol_path', 'span_hash'],
  [GraphEntityKind.Dependency]: ['repo_id', 'commit_sha', 'dependency_name', 'dependency_version'],
  [GraphEntityKind.GitHubIssue]: ['repo_id', 'issue_number'],
  [GraphEntityKind.GitHubProjectItem]: ['repo_id', 'project_item_id'],
  [GraphEntityKind.GitHubPullRequest]: ['repo_id', 'pull_request_number'],
  [GraphEntityKind.RickydataWorkIntent]: ['repo_id', 'intent_id'],
  [GraphEntityKind.RickydataAttempt]: ['repo_id', 'attempt_id'],
  [GraphEntityKind.RickydataRun]: ['repo_id', 'run_id'],
  [GraphEntityKind.RickydataPatch]: ['repo_id', 'patch_id'],
  [GraphEntityKind.RickydataProof]: ['repo_id', 'proof_id'],
  [GraphEntityKind.CIJob]: ['repo_id', 'provider', 'run_id', 'job_id'],
  [GraphEntityKind.AgentSession]: ['repo_id', 'session_id'],
  [GraphEntityKind.AgentTraceEvent]: ['repo_id', 'session_id', 'event_id'],
  [GraphEntityKind.RelaySnapshot]: ['repo_id', 'remote', 'ref_name', 'object_id'],
  [GraphEntityKind.KfdbProjection]: ['repo_id', 'projection_id'],
  [GraphEntityKind.UnderstandingSummary]: ['repo_id', 'commit_sha', 'scope', 'summary_hash'],
  [GraphEntityKind.CodeConcept]: ['repo_id', 'concept_name', 'source_hash'],
  [GraphEntityKind.DesignDecision]: ['repo_id', 'decision_id'],
  [GraphEntityKind.RickydataProductEntity]: ['repo_id', 'product_entity_id'],
  [GraphEntityKind.RoadmapItem]: ['repo_id', 'roadmap_item_id'],
  [GraphEntityKind.EvidenceRecord]: ['repo_id', 'evidence_record_id'],
  [GraphEntityKind.PriorityScoreSnapshot]: ['repo_id', 'subject_id', 'snapshot_id'],
  [GraphEntityKind.AlignmentReviewItem]: ['repo_id', 'review_item_id'],
  [GraphEntityKind.DecisionRecord]: ['repo_id', 'decision_record_id'],
  [GraphEntityKind.RoadmapSnapshot]: ['repo_id', 'roadmap_snapshot_id'],
  [GraphEntityKind.AgentContextPack]: ['repo_id', 'context_pack_id'],
  [GraphEntityKind.EvidenceRequirement]: ['repo_id', 'evidence_requirement_id'],
  [GraphEntityKind.EvidenceBundle]: ['repo_id', 'evidence_bundle_id'],
  [GraphEntityKind.ReleaseGate]: ['repo_id', 'release_gate_id'],
  [GraphEntityKind.LearningItem]: ['repo_id', 'learning_item_id'],
  [GraphEntityKind.BenchmarkRunProof]: ['repo_id', 'benchmark_run_id', 'proof_id'],
  // memory-v1: same `(source_ref, question)` ⇒ same id ⇒ idempotent merge.
  [GraphEntityKind.OpenQuestion]: ['source_ref', 'question'],
};

export function rickydataGraphContract(): RickydataGraphContract {
  return {
    schemaVersion: RICKYDATA_GRAPH_SCHEMA_VERSION,
    nodeLabels: Object.values(GraphEntityKind),
    edgeTypes: Object.values(GraphEdgeType),
    idConventions: { ...ENTITY_ID_PARTS },
  };
}

export function canonicalizeRickydataRepoRef(repoRef: string): string {
  const trimmed = repoRef.trim();
  let normalized: string;
  if (trimmed.startsWith('git@github.com:')) {
    normalized = `github.com/${trimmed.slice('git@github.com:'.length)}`;
  } else if (trimmed.startsWith('https://')) {
    normalized = trimmed.slice('https://'.length);
  } else if (trimmed.startsWith('http://')) {
    normalized = trimmed.slice('http://'.length);
  } else {
    normalized = trimmed;
  }
  return normalized.replace(/\/+$/, '').replace(/\.git$/, '').toLowerCase();
}

export function deriveRickydataGraphId(entity: GraphEntityKind, parts: Array<string | number>): string {
  const expected = ENTITY_ID_PARTS[entity];
  if (!expected) throw new Error(`Unsupported Rickydata graph entity kind: ${entity}`);
  if (parts.length !== expected.length) {
    throw new Error(`${entity} expected ${expected.length} parts (${expected.join(', ')}) but received ${parts.length}`);
  }
  const normalizedParts = parts.map((part, idx) => {
    const normalized = String(part).trim();
    if (normalized.length === 0) {
      throw new Error(`${entity} id part '${expected[idx]}' at position ${idx} must not be empty`);
    }
    return normalized;
  });
  return uuidV5(
    `${RICKYDATA_GRAPH_SCHEMA_VERSION}:${[entity, ...normalizedParts].join('\u001f')}`,
    RICKYDATA_GRAPH_NAMESPACE,
  );
}

export function deriveRickydataGraphEdgeId(from: string, edgeType: GraphEdgeType, to: string): string {
  const normalizedFrom = from.trim();
  const normalizedTo = to.trim();
  if (!normalizedFrom || !normalizedTo) throw new Error('edge endpoints must not be empty');
  return uuidV5(
    `${RICKYDATA_GRAPH_SCHEMA_VERSION}:edge:${normalizedFrom}\u001f${edgeType}\u001f${normalizedTo}`,
    RICKYDATA_GRAPH_NAMESPACE,
  );
}

export function rickydataGraphValue(input: unknown): RickydataGraphPrimitiveValue {
  if (input === null || input === undefined) return { Null: null };
  if (typeof input === 'boolean') return { Boolean: input };
  if (typeof input === 'number') return Number.isInteger(input) ? { Integer: input } : { Float: input };
  if (Array.isArray(input)) return { Array: input.map(rickydataGraphValue) };
  if (typeof input === 'object') {
    return {
      Object: Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, value]) => [key, rickydataGraphValue(value)]),
      ),
    };
  }
  return { String: String(input) };
}

export function buildRickydataGraphWriteRequest(input: RickydataGraphWriteInput): RickydataGraphWriteRequest {
  const operations: RickydataGraphWriteOperation[] = [];

  for (const node of input.nodes ?? []) {
    const id = deriveRickydataGraphId(node.kind, node.idParts);
    operations.push({
      operation: 'create_node',
      id,
      label: node.kind,
      properties: {
        ...(node.properties ?? {}),
        rickydata_graph_schema_version: { String: RICKYDATA_GRAPH_SCHEMA_VERSION },
        rickydata_graph_kind: { String: node.kind },
        rickydata_graph_id_parts: { Array: node.idParts.map((part) => ({ String: String(part) })) },
      },
      mode: 'merge',
    });
  }

  for (const edge of input.edges ?? []) {
    operations.push({
      operation: 'create_edge',
      id: deriveRickydataGraphEdgeId(edge.from, edge.edgeType, edge.to),
      from: edge.from,
      to: edge.to,
      edge_type: edge.edgeType,
      properties: {
        ...(edge.properties ?? {}),
        rickydata_graph_schema_version: { String: RICKYDATA_GRAPH_SCHEMA_VERSION },
      },
    });
  }

  return { operations, skip_embedding: true };
}

function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error('Invalid UUID namespace');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name)])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
