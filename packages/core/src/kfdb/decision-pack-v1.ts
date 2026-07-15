import { createHash } from 'node:crypto';
import {
  GraphEdgeType,
  GraphEntityKind,
  deriveRickydataGraphEdgeId,
  deriveRickydataGraphId,
  rickydataGraphValue,
  type RickydataGraphPrimitiveValue,
} from './rickydata-graph.js';

/** Canonical, additive contract shared by decision producers and consumers. */
export const DECISION_PACK_CONTRACT_VERSION = 'rickydata.decision_pack.v1';
export const CONTENT_ARTIFACT_CONTRACT_VERSION = 'content-artifact/v1';
export const CONTENT_ARTIFACT_MANIFEST_CONTRACT_VERSION = 'content-artifact-manifest/v1';
/**
 * Portable artifact chunk size. KFDB accepts values up to 2 MiB, while the
 * gateway's durable spool has a 2 MiB record ceiling. Keeping exact UTF-8
 * payloads at 256 KiB leaves room for worst-case JSON escaping plus metadata.
 */
export const CONTENT_ARTIFACT_MAX_INLINE_BYTES = 256 * 1024;

export const DecisionPackNodeLabel = {
  DecisionPack: GraphEntityKind.DecisionPack,
  DecisionSourceReceipt: GraphEntityKind.DecisionSourceReceipt,
  ContextDeliveryReceipt: GraphEntityKind.ContextDeliveryReceipt,
  DecisionObservation: GraphEntityKind.DecisionObservation,
  ContentArtifact: GraphEntityKind.ContentArtifact,
} as const;

export const DecisionPackEdgeType = {
  PacksSubject: GraphEdgeType.PacksSubject,
  IncludesArtifact: GraphEdgeType.IncludesArtifact,
  HasSourceReceipt: GraphEdgeType.HasSourceReceipt,
  ScoresPack: GraphEdgeType.ScoresPack,
  DecidesWithPack: GraphEdgeType.DecidesWithPack,
  DeliveredToSession: GraphEdgeType.DeliveredToSession,
  DeliversPack: GraphEdgeType.DeliversPack,
  ObservedInSession: GraphEdgeType.ObservedInSession,
  ObservedAgainstPack: GraphEdgeType.ObservedAgainstPack,
} as const;

export type DecisionPackCompleteness = 'complete' | 'bounded' | 'incomplete';
export type DecisionSourceStatus = 'complete' | 'bounded' | 'incomplete' | 'error' | 'not_configured';
export type DecisionKind = 'wiki_change' | 'canvas_approval' | 'github_pr' | 'tool_permission' | 'roadmap' | 'other';

export interface CanonicalGraphRef {
  nodeId: string;
  label: string;
  sourceRef?: string;
}

/** Commit-pinned repository identity observed by a local execution harness. */
export interface RepositorySnapshot {
  owner: string;
  repository: string;
  fullName: string;
  remoteUrl: string;
  branch?: string;
  commitSha?: string;
}

/**
 * A content-addressed reference to exact, observable bytes in the wallet-private
 * immutable KFDB artifact namespace. This contract never accepts or represents
 * hidden model reasoning.
 */
export interface ContentArtifactRef {
  artifactId: string;
  uri: `content-artifact:sha256:${string}`;
  contentHash: `sha256:${string}`;
  byteLength: number;
  mediaType: string;
  observableKind: string;
  storage: 'kfdb-private-kv';
  encryption: {
    scheme: 'kfdb-s2d';
    scope: 'wallet-private';
  };
  sourceRef?: string;
  chunkCount: number;
}

export interface ImmutableContentArtifactWrite {
  key: ContentArtifactRef['uri'];
  ifAbsent: true;
  value:
    | {
        contractVersion: typeof CONTENT_ARTIFACT_CONTRACT_VERSION;
        contentHash: ContentArtifactRef['contentHash'];
        byteLength: number;
        content: string;
      }
    | {
        contractVersion: typeof CONTENT_ARTIFACT_MANIFEST_CONTRACT_VERSION;
        contentHash: ContentArtifactRef['contentHash'];
        byteLength: number;
        chunks: Array<{ uri: ContentArtifactRef['uri']; contentHash: ContentArtifactRef['contentHash']; byteLength: number }>;
      };
}

export interface ContentArtifactInput {
  /** Exact observable UTF-8 content. Do not pass chain-of-thought or hidden reasoning. */
  content: string;
  mediaType: string;
  observableKind: string;
  sourceRef?: string;
}

export interface DecisionSourceReceiptInput {
  receiptKey: string;
  source: string;
  status: DecisionSourceStatus;
  cursorExhausted: boolean;
  scanLimitHit: boolean;
  returned: number;
  totalMatched?: number;
  unresolvedReferences: number;
  undecryptableRecords: number;
  droppedRecords: number;
  watermark?: string;
  cutoff?: string;
  reason?: string;
  artifacts?: ContentArtifactRef[];
}

export interface DecisionPackInput {
  walletAddress: string;
  packKey: string;
  packHash: `sha256:${string}`;
  subject: CanonicalGraphRef;
  decisionKind: DecisionKind;
  completeness: DecisionPackCompleteness;
  requiredSources: string[];
  sourceReceipts: DecisionSourceReceiptInput[];
  artifacts: ContentArtifactRef[];
  createdAt: string;
  cutoff?: string;
}

export interface ContextDeliveryReceiptInput {
  deliveryKey: string;
  session: CanonicalGraphRef;
  packId?: string;
  packHash?: `sha256:${string}`;
  renderedArtifact: ContentArtifactRef;
  interface: string;
  coverageStatus: DecisionPackCompleteness;
  omissions: Array<{ source: string; reason: string; count?: number }>;
  deliveredAt: string;
}

/** Serializable hook-level input from an actual context injection. */
export interface ObservableContextDelivery {
  deliveryKey: string;
  packId?: string;
  packHash?: `sha256:${string}`;
  renderedContent: string;
  interface: string;
  coverageStatus: DecisionPackCompleteness;
  omissions: Array<{ source: string; reason: string; count?: number }>;
  deliveredAt: string;
}

export interface DecisionObservationInput {
  observationKey: string;
  session: CanonicalGraphRef;
  packId?: string;
  kind: 'ask_user' | 'tool_permission' | 'approval_gate' | 'roadmap' | 'other';
  interface: string;
  questionArtifact: ContentArtifactRef;
  optionsArtifact?: ContentArtifactRef;
  rationaleArtifact?: ContentArtifactRef;
  optionsPresented: string[];
  selectedOption?: string;
  actor: 'human' | 'agent' | 'system';
  policyRef?: string;
  observedAt: string;
}

export type DecisionPackGraphOperation =
  | {
      operation: 'create_node';
      id: string;
      label: string;
      mode: 'merge';
      properties: Record<string, RickydataGraphPrimitiveValue>;
    }
  | {
      operation: 'create_edge';
      id: string;
      from: string;
      to: string;
      edge_type: string;
      properties: Record<string, RickydataGraphPrimitiveValue>;
    };

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function assertHash(value: string, field: string): asserts value is `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be sha256:<64 lowercase hex>`);
}

function node(
  id: string,
  label: string,
  properties: Record<string, unknown>,
): DecisionPackGraphOperation {
  return {
    operation: 'create_node',
    id,
    label,
    mode: 'merge',
    properties: Object.fromEntries(
      Object.entries({ contract_version: DECISION_PACK_CONTRACT_VERSION, ...properties })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, rickydataGraphValue(value)]),
    ),
  };
}

function edge(from: string, edgeType: GraphEdgeType, to: string, properties: Record<string, unknown> = {}): DecisionPackGraphOperation {
  assertNonEmpty(from, 'edge.from');
  assertNonEmpty(to, 'edge.to');
  return {
    operation: 'create_edge',
    id: deriveRickydataGraphEdgeId(from, edgeType, to),
    from,
    to,
    edge_type: edgeType,
    properties: Object.fromEntries(
      Object.entries({ contract_version: DECISION_PACK_CONTRACT_VERSION, ...properties })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, rickydataGraphValue(value)]),
    ),
  };
}

export function deriveContentArtifactId(contentHash: string, mediaType: string): string {
  assertHash(contentHash, 'contentHash');
  return deriveRickydataGraphId(GraphEntityKind.ContentArtifact, [contentHash, assertNonEmpty(mediaType, 'mediaType')]);
}

export function deriveDecisionPackId(walletAddress: string, packKey: string): string {
  return deriveRickydataGraphId(GraphEntityKind.DecisionPack, [
    assertNonEmpty(walletAddress, 'walletAddress').toLowerCase(),
    assertNonEmpty(packKey, 'packKey'),
  ]);
}

export function buildContentArtifactOperations(input: ContentArtifactInput): {
  ref: ContentArtifactRef;
  /** Root inline value or manifest; retained for simple consumers. */
  artifact: ImmutableContentArtifactWrite;
  /** Every immutable KV write, including chunks followed by the root manifest. */
  artifacts: ImmutableContentArtifactWrite[];
  operations: DecisionPackGraphOperation[];
} {
  const content = input.content;
  const mediaType = assertNonEmpty(input.mediaType, 'mediaType');
  const observableKind = assertNonEmpty(input.observableKind, 'observableKind');
  const hex = sha256Hex(content);
  const contentHash = `sha256:${hex}` as const;
  const uri = `content-artifact:${contentHash}` as const;
  const artifactId = deriveContentArtifactId(contentHash, mediaType);
  const byteLength = Buffer.byteLength(content, 'utf8');
  const ref: ContentArtifactRef = {
    artifactId,
    uri,
    contentHash,
    byteLength,
    mediaType,
    observableKind,
    storage: 'kfdb-private-kv',
    encryption: { scheme: 'kfdb-s2d', scope: 'wallet-private' },
    chunkCount: 1,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
  };
  const chunks = splitUtf8(content, CONTENT_ARTIFACT_MAX_INLINE_BYTES);
  ref.chunkCount = chunks.length;
  const chunkArtifacts: ImmutableContentArtifactWrite[] = chunks.map((chunk) => {
    const chunkHash = `sha256:${sha256Hex(chunk)}` as const;
    return {
      key: `content-artifact:${chunkHash}` as const,
      ifAbsent: true,
      value: {
        contractVersion: CONTENT_ARTIFACT_CONTRACT_VERSION,
        contentHash: chunkHash,
        byteLength: Buffer.byteLength(chunk, 'utf8'),
        content: chunk,
      },
    };
  });
  const artifact: ImmutableContentArtifactWrite = chunks.length === 1
    ? chunkArtifacts[0]
    : {
        key: uri,
        ifAbsent: true,
        value: {
          contractVersion: CONTENT_ARTIFACT_MANIFEST_CONTRACT_VERSION,
          contentHash,
          byteLength,
          chunks: chunkArtifacts.map((chunk) => ({
            uri: chunk.key,
            contentHash: chunk.value.contentHash,
            byteLength: chunk.value.byteLength,
          })),
        },
      };
  const artifacts = chunks.length === 1 ? [artifact] : [...chunkArtifacts, artifact];
  return {
    ref,
    artifact,
    operations: [node(artifactId, DecisionPackNodeLabel.ContentArtifact, {
      uri,
      content_hash: contentHash,
      byte_length: byteLength,
      media_type: mediaType,
      observable_kind: observableKind,
      storage: ref.storage,
      encryption_scheme: ref.encryption.scheme,
      encryption_scope: ref.encryption.scope,
      observable_only: true,
      chunk_count: ref.chunkCount,
      source_ref: input.sourceRef,
    })],
    artifacts,
  };
}

function splitUtf8(content: string, maxBytes: number): string[] {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return [content];
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of content) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (currentBytes + bytes > maxBytes && current) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  if (current || chunks.length === 0) chunks.push(current);
  if (chunks.length > 4096) throw new Error('observable content exceeds the 4096-chunk artifact limit');
  return chunks;
}

function assertCompleteSource(receipt: DecisionSourceReceiptInput): void {
  if (receipt.status !== 'complete') throw new Error(`complete pack source '${receipt.source}' has status '${receipt.status}'`);
  if (!receipt.cursorExhausted) throw new Error(`complete pack source '${receipt.source}' did not exhaust its cursor`);
  if (receipt.scanLimitHit) throw new Error(`complete pack source '${receipt.source}' hit a scan limit`);
  if (receipt.totalMatched !== undefined && receipt.returned !== receipt.totalMatched) {
    throw new Error(`complete pack source '${receipt.source}' returned ${receipt.returned}/${receipt.totalMatched}`);
  }
  if (receipt.unresolvedReferences !== 0 || receipt.undecryptableRecords !== 0 || receipt.droppedRecords !== 0) {
    throw new Error(`complete pack source '${receipt.source}' has unresolved, undecryptable, or dropped records`);
  }
  if (!receipt.watermark || !receipt.cutoff) throw new Error(`complete pack source '${receipt.source}' lacks watermark or cutoff`);
}

export function buildDecisionPackOperations(input: DecisionPackInput): {
  packId: string;
  sourceReceiptIds: string[];
  operations: DecisionPackGraphOperation[];
} {
  assertHash(input.packHash, 'packHash');
  assertNonEmpty(input.subject.nodeId, 'subject.nodeId');
  const requiredSources = [...new Set(input.requiredSources.map((source) => assertNonEmpty(source, 'requiredSources[]')))].sort();
  const receipts = [...input.sourceReceipts].sort((a, b) => `${a.source}\0${a.receiptKey}`.localeCompare(`${b.source}\0${b.receiptKey}`));
  if (input.completeness === 'complete') {
    for (const required of requiredSources) {
      const receipt = receipts.find((candidate) => candidate.source === required);
      if (!receipt) throw new Error(`complete pack is missing required source '${required}'`);
      assertCompleteSource(receipt);
    }
  }
  const packId = deriveDecisionPackId(input.walletAddress, input.packKey);
  const operations: DecisionPackGraphOperation[] = [
    node(packId, DecisionPackNodeLabel.DecisionPack, {
      wallet_address: input.walletAddress.toLowerCase(),
      pack_key: input.packKey,
      pack_hash: input.packHash,
      subject_ref: input.subject.sourceRef,
      subject_label: input.subject.label,
      decision_kind: input.decisionKind,
      completeness: input.completeness,
      required_sources: requiredSources,
      source_receipt_count: receipts.length,
      artifact_count: input.artifacts.length,
      created_at: input.createdAt,
      cutoff: input.cutoff,
    }),
    edge(packId, GraphEdgeType.PacksSubject, input.subject.nodeId, { subject_label: input.subject.label }),
  ];
  const sourceReceiptIds: string[] = [];
  for (const receipt of receipts) {
    const receiptId = deriveRickydataGraphId(GraphEntityKind.DecisionSourceReceipt, [
      packId,
      assertNonEmpty(receipt.source, 'sourceReceipt.source'),
      assertNonEmpty(receipt.receiptKey, 'sourceReceipt.receiptKey'),
    ]);
    sourceReceiptIds.push(receiptId);
    operations.push(
      node(receiptId, DecisionPackNodeLabel.DecisionSourceReceipt, {
        decision_pack_id: packId,
        receipt_key: receipt.receiptKey,
        source: receipt.source,
        status: receipt.status,
        cursor_exhausted: receipt.cursorExhausted,
        scan_limit_hit: receipt.scanLimitHit,
        returned: receipt.returned,
        total_matched: receipt.totalMatched,
        unresolved_references: receipt.unresolvedReferences,
        undecryptable_records: receipt.undecryptableRecords,
        dropped_records: receipt.droppedRecords,
        watermark: receipt.watermark,
        cutoff: receipt.cutoff,
        reason: receipt.reason,
      }),
      edge(packId, GraphEdgeType.HasSourceReceipt, receiptId, { source: receipt.source }),
    );
    for (const artifact of receipt.artifacts ?? []) {
      operations.push(edge(receiptId, GraphEdgeType.IncludesArtifact, artifact.artifactId, { content_hash: artifact.contentHash }));
    }
  }
  for (const artifact of [...input.artifacts].sort((a, b) => a.artifactId.localeCompare(b.artifactId))) {
    operations.push(edge(packId, GraphEdgeType.IncludesArtifact, artifact.artifactId, { content_hash: artifact.contentHash }));
  }
  return { packId, sourceReceiptIds, operations };
}

export function buildDecisionPackLinkOperations(input: {
  packId: string;
  scoreNodeId?: string;
  decisionNodeId?: string;
}): DecisionPackGraphOperation[] {
  const operations: DecisionPackGraphOperation[] = [];
  if (input.scoreNodeId) operations.push(edge(input.scoreNodeId, GraphEdgeType.ScoresPack, input.packId));
  if (input.decisionNodeId) operations.push(edge(input.decisionNodeId, GraphEdgeType.DecidesWithPack, input.packId));
  return operations;
}

export function buildContextDeliveryReceiptOperations(input: ContextDeliveryReceiptInput): {
  receiptId: string;
  operations: DecisionPackGraphOperation[];
} {
  if (input.packHash) assertHash(input.packHash, 'packHash');
  const receiptId = deriveRickydataGraphId(GraphEntityKind.ContextDeliveryReceipt, [
    assertNonEmpty(input.session.nodeId, 'session.nodeId'),
    assertNonEmpty(input.deliveryKey, 'deliveryKey'),
  ]);
  const operations: DecisionPackGraphOperation[] = [
    node(receiptId, DecisionPackNodeLabel.ContextDeliveryReceipt, {
      delivery_key: input.deliveryKey,
      session_label: input.session.label,
      pack_id: input.packId,
      pack_hash: input.packHash,
      rendered_artifact: input.renderedArtifact,
      rendered_context_hash: input.renderedArtifact.contentHash,
      rendered_byte_length: input.renderedArtifact.byteLength,
      interface: input.interface,
      coverage_status: input.coverageStatus,
      omissions: input.omissions,
      delivered_at: input.deliveredAt,
    }),
    edge(receiptId, GraphEdgeType.DeliveredToSession, input.session.nodeId, { session_label: input.session.label }),
    edge(receiptId, GraphEdgeType.IncludesArtifact, input.renderedArtifact.artifactId, { role: 'rendered-context' }),
  ];
  if (input.packId) operations.push(edge(receiptId, GraphEdgeType.DeliversPack, input.packId));
  return { receiptId, operations };
}

export function buildDecisionObservationOperations(input: DecisionObservationInput): {
  observationId: string;
  operations: DecisionPackGraphOperation[];
} {
  const observationId = deriveRickydataGraphId(GraphEntityKind.DecisionObservation, [
    assertNonEmpty(input.session.nodeId, 'session.nodeId'),
    assertNonEmpty(input.observationKey, 'observationKey'),
  ]);
  const operations: DecisionPackGraphOperation[] = [
    node(observationId, DecisionPackNodeLabel.DecisionObservation, {
      observation_key: input.observationKey,
      kind: input.kind,
      interface: input.interface,
      actor: input.actor,
      question_artifact: input.questionArtifact,
      options_artifact: input.optionsArtifact,
      rationale_artifact: input.rationaleArtifact,
      options_presented: input.optionsPresented,
      selected_option: input.selectedOption,
      policy_ref: input.policyRef,
      observed_at: input.observedAt,
      pack_id: input.packId,
    }),
    edge(observationId, GraphEdgeType.ObservedInSession, input.session.nodeId, { session_label: input.session.label }),
    edge(observationId, GraphEdgeType.IncludesArtifact, input.questionArtifact.artifactId, { role: 'question' }),
  ];
  if (input.optionsArtifact) operations.push(edge(observationId, GraphEdgeType.IncludesArtifact, input.optionsArtifact.artifactId, { role: 'options' }));
  if (input.rationaleArtifact) operations.push(edge(observationId, GraphEdgeType.IncludesArtifact, input.rationaleArtifact.artifactId, { role: 'rationale' }));
  if (input.packId) operations.push(edge(observationId, GraphEdgeType.ObservedAgainstPack, input.packId));
  return { observationId, operations };
}
