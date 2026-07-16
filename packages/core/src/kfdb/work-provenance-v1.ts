import {
  GraphEdgeType,
  GraphEntityKind,
  deriveRickydataGraphEdgeId,
  deriveRickydataGraphId,
  rickydataGraphValue,
  type RickydataGraphWriteOperation,
} from './rickydata-graph.js';
import type { CanonicalGraphRef, ContentArtifactRef, RepositorySnapshot } from './decision-pack-v1.js';

export const WORK_PROVENANCE_CONTRACT_VERSION = 'rickydata.work_provenance.v1';

export type Sha256Ref = `sha256:${string}`;
export type VerificationPhase = 'base' | 'resolution';
export type VerificationOutcome = 'pass' | 'fail' | 'error' | 'skipped';
export type RunOutcomeStatus = 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/** Portable reference to an immutable work contract authored outside this SDK. */
export interface WorkContractRef {
  contractId: string;
  contractHash: Sha256Ref;
  nodeId: string;
  schemaVersion: string;
  sourceIntentRef?: string;
}

export interface ObjectiveObservationInput {
  observationKey: string;
  session: CanonicalGraphRef;
  objectiveArtifact: ContentArtifactRef;
  workContract?: WorkContractRef;
  rootObservationId?: string;
  observedAt: string;
}

export interface RepositoryStateReceiptInput {
  receiptKey: string;
  session: CanonicalGraphRef;
  workContract?: WorkContractRef;
  phase: 'base' | 'result' | 'intermediate';
  repository: RepositorySnapshot;
  observedAt: string;
}

export interface VerificationObservationInput {
  verificationKey: string;
  session?: CanonicalGraphRef;
  workContract: WorkContractRef;
  criterionId: string;
  phase: VerificationPhase;
  verifierKind: string;
  commandHash?: Sha256Ref;
  manifestHash?: Sha256Ref;
  expectedOutcome: VerificationOutcome;
  observedOutcome: VerificationOutcome;
  exitCode?: number | null;
  failureSignatureHash?: Sha256Ref | null;
  passed: boolean;
  observedAt: string;
}

export interface RunUsageReceiptInput {
  receiptKey: string;
  run: CanonicalGraphRef;
  workContract?: WorkContractRef;
  provider?: string;
  model?: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: number | null;
  toolCalls: number | null;
  durationMs: number | null;
  measuredAt: string;
}

export interface RunOutcomeReceiptInput {
  receiptKey: string;
  run: CanonicalGraphRef;
  workContract?: WorkContractRef;
  status: RunOutcomeStatus;
  resultCommit?: string | null;
  filesChanged: number | null;
  testsPassed: boolean | null;
  failureClass: string | null;
  usageReceiptId?: string;
  completedAt: string;
}

function assertNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

function assertHash(value: string, field: string): asserts value is Sha256Ref {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error(`${field} must be sha256:<64 lowercase hex>`);
}

function validateWorkContract(contract: WorkContractRef): void {
  assertNonEmpty(contract.contractId, 'workContract.contractId');
  assertNonEmpty(contract.nodeId, 'workContract.nodeId');
  assertNonEmpty(contract.schemaVersion, 'workContract.schemaVersion');
  assertHash(contract.contractHash, 'workContract.contractHash');
}

function node(id: string, label: GraphEntityKind, properties: Record<string, unknown>): RickydataGraphWriteOperation {
  return {
    operation: 'create_node',
    id,
    label,
    mode: 'merge',
    properties: Object.fromEntries(
      Object.entries({ contract_version: WORK_PROVENANCE_CONTRACT_VERSION, ...properties })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, rickydataGraphValue(value)]),
    ),
  };
}

function edge(from: string, edgeType: GraphEdgeType, to: string, properties: Record<string, unknown> = {}): RickydataGraphWriteOperation {
  assertNonEmpty(from, 'edge.from');
  assertNonEmpty(to, 'edge.to');
  return {
    operation: 'create_edge',
    id: deriveRickydataGraphEdgeId(from, edgeType, to),
    from,
    to,
    edge_type: edgeType,
    properties: Object.fromEntries(
      Object.entries({ contract_version: WORK_PROVENANCE_CONTRACT_VERSION, ...properties })
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, rickydataGraphValue(value)]),
    ),
  };
}

function contractProperties(contract: WorkContractRef | undefined): Record<string, unknown> {
  if (!contract) return {};
  validateWorkContract(contract);
  return {
    work_contract_id: contract.contractId,
    work_contract_hash: contract.contractHash,
    work_contract_schema_version: contract.schemaVersion,
    source_intent_ref: contract.sourceIntentRef,
  };
}

function addContractEdge(operations: RickydataGraphWriteOperation[], from: string, contract?: WorkContractRef): void {
  if (contract) operations.push(edge(from, GraphEdgeType.GovernedByContract, contract.nodeId));
}

export function buildObjectiveObservationOperations(input: ObjectiveObservationInput): {
  observationId: string;
  operations: RickydataGraphWriteOperation[];
} {
  const observationId = deriveRickydataGraphId(GraphEntityKind.ObjectiveObservation, [
    assertNonEmpty(input.session.nodeId, 'session.nodeId'),
    assertNonEmpty(input.observationKey, 'observationKey'),
  ]);
  const operations = [
    node(observationId, GraphEntityKind.ObjectiveObservation, {
      observation_key: input.observationKey,
      session_label: input.session.label,
      objective_artifact: input.objectiveArtifact,
      root_observation_id: input.rootObservationId,
      observed_at: input.observedAt,
      ...contractProperties(input.workContract),
    }),
    edge(observationId, GraphEdgeType.ObservedInSession, input.session.nodeId, { session_label: input.session.label }),
    edge(observationId, GraphEdgeType.IncludesArtifact, input.objectiveArtifact.artifactId, { role: 'objective' }),
  ];
  addContractEdge(operations, observationId, input.workContract);
  return { observationId, operations };
}

export function buildRepositoryStateReceiptOperations(input: RepositoryStateReceiptInput): {
  receiptId: string;
  operations: RickydataGraphWriteOperation[];
} {
  const receiptId = deriveRickydataGraphId(GraphEntityKind.RepositoryStateReceipt, [
    assertNonEmpty(input.session.nodeId, 'session.nodeId'),
    assertNonEmpty(input.receiptKey, 'receiptKey'),
  ]);
  const operations = [
    node(receiptId, GraphEntityKind.RepositoryStateReceipt, {
      receipt_key: input.receiptKey,
      phase: input.phase,
      owner: input.repository.owner,
      repository: input.repository.repository,
      full_name: input.repository.fullName,
      remote_url: input.repository.remoteUrl,
      branch: input.repository.branch,
      commit_sha: input.repository.commitSha,
      tree_hash: input.repository.treeHash,
      dirty: input.repository.dirty,
      dirty_state_hash: input.repository.dirtyStateHash,
      observed_at: input.observedAt,
      ...contractProperties(input.workContract),
    }),
    edge(receiptId, GraphEdgeType.ObservedRepositoryState, input.session.nodeId, { phase: input.phase }),
  ];
  addContractEdge(operations, receiptId, input.workContract);
  return { receiptId, operations };
}

export function buildVerificationObservationOperations(input: VerificationObservationInput): {
  observationId: string;
  operations: RickydataGraphWriteOperation[];
} {
  validateWorkContract(input.workContract);
  if (input.commandHash) assertHash(input.commandHash, 'commandHash');
  if (input.manifestHash) assertHash(input.manifestHash, 'manifestHash');
  if (input.failureSignatureHash) assertHash(input.failureSignatureHash, 'failureSignatureHash');
  const observationId = deriveRickydataGraphId(GraphEntityKind.VerificationObservation, [
    input.workContract.contractId,
    assertNonEmpty(input.verificationKey, 'verificationKey'),
  ]);
  const operations = [
    node(observationId, GraphEntityKind.VerificationObservation, {
      verification_key: input.verificationKey,
      criterion_id: input.criterionId,
      phase: input.phase,
      verifier_kind: input.verifierKind,
      command_hash: input.commandHash,
      manifest_hash: input.manifestHash,
      expected_outcome: input.expectedOutcome,
      observed_outcome: input.observedOutcome,
      exit_code: input.exitCode,
      failure_signature_hash: input.failureSignatureHash,
      passed: input.passed,
      observed_at: input.observedAt,
      ...contractProperties(input.workContract),
    }),
    edge(observationId, GraphEdgeType.VerifiesContract, input.workContract.nodeId, { criterion_id: input.criterionId, phase: input.phase }),
  ];
  if (input.session) operations.push(edge(observationId, GraphEdgeType.ObservedInSession, input.session.nodeId));
  return { observationId, operations };
}

export function buildRunUsageReceiptOperations(input: RunUsageReceiptInput): {
  receiptId: string;
  operations: RickydataGraphWriteOperation[];
} {
  const receiptId = deriveRickydataGraphId(GraphEntityKind.RunUsageReceipt, [
    assertNonEmpty(input.run.nodeId, 'run.nodeId'),
    assertNonEmpty(input.receiptKey, 'receiptKey'),
  ]);
  const operations = [
    node(receiptId, GraphEntityKind.RunUsageReceipt, {
      receipt_key: input.receiptKey,
      provider: input.provider,
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cached_input_tokens: (input.cachedInputTokens),
      cost_usd: input.costUsd,
      tool_calls: input.toolCalls,
      duration_ms: input.durationMs,
      measured_at: input.measuredAt,
      ...contractProperties(input.workContract),
    }),
    edge(receiptId, GraphEdgeType.MeasuresRun, input.run.nodeId),
  ];
  addContractEdge(operations, receiptId, input.workContract);
  return { receiptId, operations };
}

export function buildRunOutcomeReceiptOperations(input: RunOutcomeReceiptInput): {
  receiptId: string;
  operations: RickydataGraphWriteOperation[];
} {
  const receiptId = deriveRickydataGraphId(GraphEntityKind.RunOutcomeReceipt, [
    assertNonEmpty(input.run.nodeId, 'run.nodeId'),
    assertNonEmpty(input.receiptKey, 'receiptKey'),
  ]);
  const operations = [
    node(receiptId, GraphEntityKind.RunOutcomeReceipt, {
      receipt_key: input.receiptKey,
      status: input.status,
      result_commit: input.resultCommit,
      files_changed: input.filesChanged,
      tests_passed: input.testsPassed,
      failure_class: input.failureClass,
      usage_receipt_id: input.usageReceiptId,
      completed_at: input.completedAt,
      ...contractProperties(input.workContract),
    }),
    edge(receiptId, GraphEdgeType.ReportsOutcome, input.run.nodeId),
  ];
  if (input.usageReceiptId) operations.push(edge(receiptId, GraphEdgeType.UsesUsageReceipt, input.usageReceiptId));
  addContractEdge(operations, receiptId, input.workContract);
  return { receiptId, operations };
}
