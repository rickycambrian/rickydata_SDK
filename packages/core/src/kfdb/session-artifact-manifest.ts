import {
  buildContentArtifactOperations,
  type CanonicalGraphRef,
  type ContentArtifactRef,
  type ImmutableContentArtifactWrite,
  type RepositorySnapshot,
} from './decision-pack-v1.js';
import {
  GraphEdgeType,
  GraphEntityKind,
  deriveRickydataGraphEdgeId,
  deriveRickydataGraphId,
  rickydataGraphValue,
} from './rickydata-graph.js';

export const SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION = 'rickydata.session_artifact_manifest.v1';
export const SESSION_ARTIFACT_MANIFEST_MEDIA_TYPE = 'application/vnd.rickydata.session-artifact-manifest+json; version=1';

export type SessionArtifactManifestEngine = 'claude-code' | 'codex';

export interface SessionArtifactManifestEntry {
  sequence: number;
  eventType: string;
  receivedAt: number;
  role: string;
  toolName?: string;
  toolUseId?: string;
  artifact: ContentArtifactRef;
}

export interface SessionArtifactManifestInput {
  engine: SessionArtifactManifestEngine;
  runtime: { agentId: string; model?: string; cwd?: string };
  session: CanonicalGraphRef & { externalSessionId: string };
  turn: CanonicalGraphRef & {
    externalTurnId?: string;
    index: number;
    startedAt: number;
    completedAt: number;
  };
  repository?: RepositorySnapshot;
  entries: SessionArtifactManifestEntry[];
}

export interface SessionArtifactManifestDocument {
  contractVersion: typeof SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION;
  engine: SessionArtifactManifestEngine;
  runtime: { agentId: string; model?: string; cwd?: string };
  session: { nodeId: string; label: string; externalSessionId: string };
  turn: {
    nodeId: string;
    label: string;
    externalTurnId?: string;
    index: number;
    startedAt: number;
    completedAt: number;
  };
  repository?: RepositorySnapshot;
  entries: SessionArtifactManifestEntry[];
}

function nonEmpty(input: string, field: string): string {
  const value = input.trim();
  if (!value) throw new Error(`${field} must not be empty`);
  return value;
}

function manifestDocument(input: SessionArtifactManifestInput): SessionArtifactManifestDocument {
  const entries = input.entries
    .map((entry, insertionIndex) => ({ entry, insertionIndex }))
    .sort((left, right) => left.entry.sequence - right.entry.sequence || left.insertionIndex - right.insertionIndex)
    .map(({ entry }) => ({
      sequence: entry.sequence,
      eventType: nonEmpty(entry.eventType, 'entry.eventType'),
      receivedAt: entry.receivedAt,
      role: nonEmpty(entry.role, 'entry.role'),
      ...(entry.toolName ? { toolName: entry.toolName } : {}),
      ...(entry.toolUseId ? { toolUseId: entry.toolUseId } : {}),
      artifact: entry.artifact,
    }));
  return {
    contractVersion: SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION,
    engine: input.engine,
    runtime: {
      agentId: nonEmpty(input.runtime.agentId, 'runtime.agentId'),
      ...(input.runtime.model ? { model: input.runtime.model } : {}),
      ...(input.runtime.cwd ? { cwd: input.runtime.cwd } : {}),
    },
    session: {
      nodeId: nonEmpty(input.session.nodeId, 'session.nodeId'),
      label: nonEmpty(input.session.label, 'session.label'),
      externalSessionId: nonEmpty(input.session.externalSessionId, 'session.externalSessionId'),
    },
    turn: {
      nodeId: nonEmpty(input.turn.nodeId, 'turn.nodeId'),
      label: nonEmpty(input.turn.label, 'turn.label'),
      ...(input.turn.externalTurnId ? { externalTurnId: input.turn.externalTurnId } : {}),
      index: input.turn.index,
      startedAt: input.turn.startedAt,
      completedAt: input.turn.completedAt,
    },
    ...(input.repository ? { repository: input.repository } : {}),
    entries,
  };
}

/**
 * Build one low-cardinality graph index for the exact observable artifacts in
 * a turn. The manifest contains references only; prompt, assistant, and tool
 * bytes remain in the immutable wallet-private content-artifact namespace.
 */
export function buildSessionArtifactManifestOperations(input: SessionArtifactManifestInput): {
  manifestId: string;
  manifest: SessionArtifactManifestDocument;
  manifestArtifact: ContentArtifactRef;
  operations: Array<Record<string, unknown>>;
  contentArtifacts: ImmutableContentArtifactWrite[];
} {
  const manifest = manifestDocument(input);
  const content = JSON.stringify(manifest);
  const built = buildContentArtifactOperations({
    content,
    mediaType: SESSION_ARTIFACT_MANIFEST_MEDIA_TYPE,
    observableKind: 'session-artifact-manifest',
    sourceRef: `session-artifact-manifest:${input.engine}:${manifest.session.externalSessionId}:${manifest.turn.index}`,
  });
  const manifestId = deriveRickydataGraphId(GraphEntityKind.SessionArtifactManifest, [
    manifest.session.nodeId,
    manifest.turn.nodeId,
  ]);
  const operations: Array<Record<string, unknown>> = [
    ...built.operations,
    {
      operation: 'create_node',
      id: manifestId,
      label: GraphEntityKind.SessionArtifactManifest,
      mode: 'merge',
      properties: {
        contract_version: rickydataGraphValue(SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION),
        engine: rickydataGraphValue(manifest.engine),
        agent_id: rickydataGraphValue(manifest.runtime.agentId),
        model: rickydataGraphValue(manifest.runtime.model),
        cwd: rickydataGraphValue(manifest.runtime.cwd),
        session_node_id: rickydataGraphValue(manifest.session.nodeId),
        session_label: rickydataGraphValue(manifest.session.label),
        external_session_id: rickydataGraphValue(manifest.session.externalSessionId),
        turn_node_id: rickydataGraphValue(manifest.turn.nodeId),
        turn_label: rickydataGraphValue(manifest.turn.label),
        external_turn_id: rickydataGraphValue(manifest.turn.externalTurnId),
        turn_index: rickydataGraphValue(manifest.turn.index),
        started_at: rickydataGraphValue(manifest.turn.startedAt),
        completed_at: rickydataGraphValue(manifest.turn.completedAt),
        entry_count: rickydataGraphValue(manifest.entries.length),
        repository: rickydataGraphValue(manifest.repository),
        manifest_artifact: rickydataGraphValue(built.ref),
        manifest_content_hash: rickydataGraphValue(built.ref.contentHash),
      },
    },
    {
      operation: 'create_edge',
      id: deriveRickydataGraphEdgeId(manifest.turn.nodeId, GraphEdgeType.HasArtifactManifest, manifestId),
      from: manifest.turn.nodeId,
      to: manifestId,
      edge_type: GraphEdgeType.HasArtifactManifest,
      properties: {
        contract_version: rickydataGraphValue(SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION),
        turn_index: rickydataGraphValue(manifest.turn.index),
      },
    },
    {
      operation: 'create_edge',
      id: deriveRickydataGraphEdgeId(manifestId, GraphEdgeType.IncludesArtifact, built.ref.artifactId),
      from: manifestId,
      to: built.ref.artifactId,
      edge_type: GraphEdgeType.IncludesArtifact,
      properties: {
        contract_version: rickydataGraphValue(SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION),
        role: rickydataGraphValue('manifest-document'),
        content_hash: rickydataGraphValue(built.ref.contentHash),
      },
    },
  ];
  return {
    manifestId,
    manifest,
    manifestArtifact: built.ref,
    operations,
    contentArtifacts: built.artifacts,
  };
}
