import { describe, expect, it } from 'vitest';
import {
  WORK_PROVENANCE_CONTRACT_VERSION,
  buildObjectiveObservationOperations,
  buildRepositoryStateReceiptOperations,
  buildRunOutcomeReceiptOperations,
  buildRunUsageReceiptOperations,
  buildVerificationObservationOperations,
} from '../src/kfdb/index.js';

const session = { nodeId: 'session-1', label: 'AgentSession' };
const contract = {
  contractId: 'work-contract-1',
  contractHash: `sha256:${'a'.repeat(64)}` as const,
  nodeId: 'work-contract-node-1',
  schemaVersion: 'agent.work_contract.v1',
  sourceIntentRef: `sha256:${'b'.repeat(64)}`,
};

describe('rickydata work-provenance v1 contract', () => {
  it('builds deterministic objective and repository-state receipts around the same contract', () => {
    const objective = buildObjectiveObservationOperations({
      observationKey: 'first-user-prompt',
      session,
      objectiveArtifact: {
        artifactId: 'objective-artifact',
        uri: `content-artifact:sha256:${'c'.repeat(64)}`,
        contentHash: `sha256:${'c'.repeat(64)}`,
        byteLength: 17,
        mediaType: 'text/plain',
        observableKind: 'human-objective',
        storage: 'kfdb-private-kv',
        encryption: { scheme: 'kfdb-s2d', scope: 'wallet-private' },
        chunkCount: 1,
      },
      workContract: contract,
      observedAt: '2026-07-16T10:00:00.000Z',
    });
    const repositoryState = buildRepositoryStateReceiptOperations({
      receiptKey: 'base',
      session,
      workContract: contract,
      phase: 'base',
      repository: {
        owner: 'rickycambrian',
        repository: 'rickydata_home',
        fullName: 'rickycambrian/rickydata_home',
        remoteUrl: 'https://github.com/rickycambrian/rickydata_home.git',
        branch: 'main',
        commitSha: '1'.repeat(40),
        treeHash: '2'.repeat(40),
        dirty: true,
        dirtyStateHash: `sha256:${'d'.repeat(64)}`,
      },
      observedAt: '2026-07-16T10:00:00.000Z',
    });

    expect(objective.operations[0]).toMatchObject({
      label: 'ObjectiveObservation',
      properties: { contract_version: { String: WORK_PROVENANCE_CONTRACT_VERSION } },
    });
    expect(objective.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ edge_type: 'OBSERVED_IN_SESSION', to: session.nodeId }),
      expect.objectContaining({ edge_type: 'GOVERNED_BY_CONTRACT', to: contract.nodeId }),
      expect.objectContaining({ edge_type: 'INCLUDES_ARTIFACT', to: 'objective-artifact' }),
    ]));
    expect(repositoryState.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ edge_type: 'OBSERVED_REPOSITORY_STATE', to: session.nodeId }),
      expect.objectContaining({ edge_type: 'GOVERNED_BY_CONTRACT', to: contract.nodeId }),
    ]));
    expect(repositoryState.operations[0]).toMatchObject({
      properties: {
        phase: { String: 'base' },
        commit_sha: { String: '1'.repeat(40) },
        tree_hash: { String: '2'.repeat(40) },
        dirty_state_hash: { String: `sha256:${'d'.repeat(64)}` },
      },
    });
  });

  it('records base and resolution verification without collapsing expected and observed outcomes', () => {
    const base = buildVerificationObservationOperations({
      verificationKey: 'criterion-tests:base',
      session,
      workContract: contract,
      criterionId: 'criterion-tests',
      phase: 'base',
      verifierKind: 'tests',
      commandHash: `sha256:${'e'.repeat(64)}`,
      expectedOutcome: 'fail',
      observedOutcome: 'fail',
      exitCode: 1,
      failureSignatureHash: `sha256:${'f'.repeat(64)}`,
      passed: true,
      observedAt: '2026-07-16T10:01:00.000Z',
    });
    const resolution = buildVerificationObservationOperations({
      verificationKey: 'criterion-tests:resolution',
      session,
      workContract: contract,
      criterionId: 'criterion-tests',
      phase: 'resolution',
      verifierKind: 'tests',
      expectedOutcome: 'pass',
      observedOutcome: 'pass',
      exitCode: 0,
      passed: true,
      observedAt: '2026-07-16T10:30:00.000Z',
    });

    expect(base.observationId).not.toBe(resolution.observationId);
    expect(base.operations[0]).toMatchObject({
      properties: {
        expected_outcome: { String: 'fail' },
        observed_outcome: { String: 'fail' },
        exit_code: { Integer: 1 },
        passed: { Boolean: true },
      },
    });
    expect(base.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ edge_type: 'VERIFIES_CONTRACT', to: contract.nodeId }),
    ]));
  });

  it('keeps unknown usage null and correlates actual usage with a terminal outcome', () => {
    const usage = buildRunUsageReceiptOperations({
      receiptKey: 'usage-final',
      run: { nodeId: 'run-1', label: 'RickydataRun' },
      workContract: contract,
      provider: 'anthropic',
      model: 'claude-sonnet',
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: null,
      costUsd: null,
      toolCalls: 3,
      durationMs: 4500,
      measuredAt: '2026-07-16T10:30:00.000Z',
    });
    const outcome = buildRunOutcomeReceiptOperations({
      receiptKey: 'outcome-final',
      run: { nodeId: 'run-1', label: 'RickydataRun' },
      workContract: contract,
      status: 'succeeded',
      resultCommit: '3'.repeat(40),
      filesChanged: 4,
      testsPassed: true,
      failureClass: null,
      usageReceiptId: usage.receiptId,
      completedAt: '2026-07-16T10:30:00.000Z',
    });

    expect(usage.operations[0]).toMatchObject({
      properties: {
        input_tokens: { Integer: 100 },
        cached_input_tokens: { Null: null },
        cost_usd: { Null: null },
      },
    });
    expect(outcome.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ edge_type: 'REPORTS_OUTCOME', to: 'run-1' }),
      expect.objectContaining({ edge_type: 'USES_USAGE_RECEIPT', to: usage.receiptId }),
    ]));
  });
});
