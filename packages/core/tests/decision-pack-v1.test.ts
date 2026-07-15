import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DECISION_PACK_CONTRACT_VERSION,
  CONTENT_ARTIFACT_MAX_INLINE_BYTES,
  DecisionPackEdgeType,
  DecisionPackNodeLabel,
  buildContentArtifactOperations,
  buildContextDeliveryReceiptOperations,
  buildDecisionObservationOperations,
  buildDecisionPackLinkOperations,
  buildDecisionPackOperations,
  deriveContentArtifactId,
  deriveDecisionPackId,
} from '../src/kfdb/index.js';

describe('rickydata decision-pack v1 contract', () => {
  it('publishes the cross-repository JSON Schema with every canonical receipt type', () => {
    const schema = JSON.parse(readFileSync(new URL('../contracts/decision-pack-v1.schema.json', import.meta.url), 'utf8'));
    expect(schema.$defs).toHaveProperty('DecisionPack');
    expect(schema.$defs).toHaveProperty('DecisionSourceReceipt');
    expect(schema.$defs).toHaveProperty('ContextDeliveryReceipt');
    expect(schema.$defs).toHaveProperty('DecisionObservation');
    expect(schema.$defs).toHaveProperty('ContentArtifactRef');
    expect(schema.$defs.ContentArtifactRef.properties.storage.const).toBe('kfdb-private-kv');
    expect(schema.$defs.ContentArtifactRef.properties.chunkCount.maximum).toBe(4096);
  });

  it('builds deterministic references and immutable private-KV payloads for observable content', () => {
    const first = buildContentArtifactOperations({
      content: '🚀 complete observable prompt',
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'human-prompt',
    });
    const second = buildContentArtifactOperations({
      content: '🚀 complete observable prompt',
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'human-prompt',
    });

    expect(first.ref).toEqual(second.ref);
    expect(first.artifact).toEqual(second.artifact);
    expect(first.ref.artifactId).toBe(deriveContentArtifactId(first.ref.contentHash, first.ref.mediaType));
    expect(first.ref.encryption).toEqual({ scheme: 'kfdb-s2d', scope: 'wallet-private' });
    expect(first.ref.uri).toBe(`content-artifact:${first.ref.contentHash}`);
    expect(first.ref.storage).toBe('kfdb-private-kv');
    expect(first.ref.byteLength).toBe(Buffer.byteLength('🚀 complete observable prompt'));
    expect(first.artifact).toMatchObject({
      key: first.ref.uri,
      ifAbsent: true,
      value: {
        contractVersion: 'content-artifact/v1',
        contentHash: first.ref.contentHash,
        content: '🚀 complete observable prompt',
      },
    });
    expect(first.operations[0]).toMatchObject({
      operation: 'create_node',
      label: DecisionPackNodeLabel.ContentArtifact,
      id: first.ref.artifactId,
      properties: {
        content_hash: { String: first.ref.contentHash },
        encryption_scheme: { String: 'kfdb-s2d' },
        encryption_scope: { String: 'wallet-private' },
        observable_only: { Boolean: true },
      },
    });
  });

  it('chunks content above the portable inline ceiling into immutable UTF-8 artifacts plus a root manifest', () => {
    const content = `${'a'.repeat(CONTENT_ARTIFACT_MAX_INLINE_BYTES - 1)}🚀tail`;
    const built = buildContentArtifactOperations({ content, mediaType: 'text/plain', observableKind: 'tool-output' });
    expect(built.ref.chunkCount).toBe(2);
    expect(built.artifacts).toHaveLength(3);
    expect(built.artifact.value.contractVersion).toBe('content-artifact-manifest/v1');
    const chunks = built.artifacts.slice(0, -1);
    expect(chunks.every((chunk) => chunk.value.contractVersion === 'content-artifact/v1')).toBe(true);
    expect(chunks.reduce((sum, chunk) => sum + chunk.value.byteLength, 0)).toBe(Buffer.byteLength(content));
  });

  it('builds a complete pack with deterministic source receipts and subject/artifact edges', () => {
    const artifact = buildContentArtifactOperations({
      content: '{"diff":"exact"}',
      mediaType: 'application/json',
      observableKind: 'github-diff',
    }).ref;
    const input = {
      walletAddress: '0xABC',
      packKey: 'github-pr:owner/repo#42:head-sha',
      packHash: `sha256:${'1'.repeat(64)}`,
      subject: { nodeId: 'subject-node', label: 'DecisionSubject', sourceRef: 'github-pr:owner/repo#42' },
      decisionKind: 'github_pr' as const,
      completeness: 'complete' as const,
      requiredSources: ['github', 'execution'],
      sourceReceipts: [
        {
          receiptKey: 'github@watermark-1',
          source: 'github',
          status: 'complete' as const,
          cursorExhausted: true,
          scanLimitHit: false,
          returned: 12,
          totalMatched: 12,
          unresolvedReferences: 0,
          undecryptableRecords: 0,
          droppedRecords: 0,
          watermark: 'watermark-1',
          cutoff: '2026-07-15T12:00:00.000Z',
          artifacts: [artifact],
        },
        {
          receiptKey: 'execution@watermark-2',
          source: 'execution',
          status: 'complete' as const,
          cursorExhausted: true,
          scanLimitHit: false,
          returned: 3,
          totalMatched: 3,
          unresolvedReferences: 0,
          undecryptableRecords: 0,
          droppedRecords: 0,
          watermark: 'watermark-2',
          cutoff: '2026-07-15T12:00:00.000Z',
        },
      ],
      artifacts: [artifact],
      createdAt: '2026-07-15T12:00:00.000Z',
    };
    const first = buildDecisionPackOperations(input);
    const second = buildDecisionPackOperations(input);
    const packId = deriveDecisionPackId('0xabc', input.packKey);

    expect(first).toEqual(second);
    expect(first.packId).toBe(packId);
    expect(first.operations[0]).toMatchObject({
      operation: 'create_node',
      label: DecisionPackNodeLabel.DecisionPack,
      id: packId,
      properties: {
        contract_version: { String: DECISION_PACK_CONTRACT_VERSION },
        completeness: { String: 'complete' },
      },
    });
    expect(first.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: packId, to: 'subject-node', edge_type: DecisionPackEdgeType.PacksSubject }),
        expect.objectContaining({ from: packId, to: artifact.artifactId, edge_type: DecisionPackEdgeType.IncludesArtifact }),
        expect.objectContaining({ edge_type: DecisionPackEdgeType.HasSourceReceipt }),
      ]),
    );
  });

  it('binds score and human decision nodes to the exact pack', () => {
    const operations = buildDecisionPackLinkOperations({
      packId: 'pack-node',
      scoreNodeId: 'levanto-score-node',
      decisionNodeId: 'home-decision-node',
    });

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'levanto-score-node',
          to: 'pack-node',
          edge_type: DecisionPackEdgeType.ScoresPack,
        }),
        expect.objectContaining({
          from: 'home-decision-node',
          to: 'pack-node',
          edge_type: DecisionPackEdgeType.DecidesWithPack,
        }),
      ]),
    );
  });

  it('refuses to certify complete when a required source is capped or unresolved', () => {
    expect(() => buildDecisionPackOperations({
      walletAddress: '0xabc',
      packKey: 'tool-permission:session:1',
      packHash: `sha256:${'3'.repeat(64)}`,
      subject: { nodeId: 'subject-node', label: 'DecisionSubject' },
      decisionKind: 'tool_permission',
      completeness: 'complete',
      requiredSources: ['session'],
      sourceReceipts: [{
        receiptKey: 'session:1',
        source: 'session',
        status: 'complete',
        cursorExhausted: false,
        scanLimitHit: true,
        returned: 500,
        totalMatched: 501,
        unresolvedReferences: 1,
        undecryptableRecords: 0,
        droppedRecords: 0,
        watermark: 'w',
        cutoff: '2026-07-15T12:00:00.000Z',
      }],
      artifacts: [],
      createdAt: '2026-07-15T12:00:00.000Z',
    })).toThrow(/did not exhaust|scan limit|returned|unresolved/);
  });

  it('records exact rendered context delivery and observable human decisions against sessions', () => {
    const rendered = buildContentArtifactOperations({
      content: 'exact rendered bytes',
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'rendered-context',
    }).ref;
    const question = buildContentArtifactOperations({
      content: 'Allow deployment?',
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'decision-question',
    }).ref;
    const options = buildContentArtifactOperations({
      content: '["allow","deny"]',
      mediaType: 'application/json',
      observableKind: 'decision-options',
    }).ref;
    const delivery = buildContextDeliveryReceiptOperations({
      deliveryKey: 'session-start:0',
      session: { nodeId: 'session-node', label: 'ClaudeCodeSession' },
      packId: 'pack-node',
      packHash: `sha256:${'2'.repeat(64)}`,
      renderedArtifact: rendered,
      interface: 'claude-code-session-start',
      coverageStatus: 'complete',
      omissions: [],
      deliveredAt: '2026-07-15T12:01:00.000Z',
    });
    const observation = buildDecisionObservationOperations({
      observationKey: 'permission:toolu_1',
      session: { nodeId: 'session-node', label: 'ClaudeCodeSession' },
      packId: 'pack-node',
      kind: 'tool_permission',
      interface: 'claude-code',
      questionArtifact: question,
      optionsArtifact: options,
      optionsPresented: ['allow', 'deny'],
      selectedOption: 'allow',
      actor: 'human',
      observedAt: '2026-07-15T12:02:00.000Z',
    });

    expect(delivery.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: delivery.receiptId,
          to: 'session-node',
          edge_type: DecisionPackEdgeType.DeliveredToSession,
        }),
      ]),
    );
    expect(observation.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: observation.observationId,
          to: 'session-node',
          edge_type: DecisionPackEdgeType.ObservedInSession,
        }),
        expect.objectContaining({
          from: observation.observationId,
          to: 'pack-node',
          edge_type: DecisionPackEdgeType.ObservedAgainstPack,
        }),
      ]),
    );
  });
});
