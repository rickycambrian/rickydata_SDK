import { describe, expect, it } from 'vitest';
import { buildContentArtifactOperations } from '../src/kfdb/decision-pack-v1.js';
import {
  SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION,
  buildSessionArtifactManifestOperations,
} from '../src/kfdb/session-artifact-manifest.js';

describe('buildSessionArtifactManifestOperations', () => {
  it('writes one deterministic low-cardinality manifest with ordered private artifact refs', () => {
    const prompt = buildContentArtifactOperations({
      content: 'What changed?',
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'human-prompt',
      sourceRef: 'codex:session-1:turn-1:0:human-prompt',
    });
    const answer = buildContentArtifactOperations({
      content: 'The tests now pass.',
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'assistant-message',
      sourceRef: 'codex:session-1:turn-1:1:assistant-message',
    });
    const input = {
      engine: 'codex' as const,
      session: { nodeId: 'session-node', label: 'CodexSession', externalSessionId: 'session-1' },
      turn: {
        nodeId: 'turn-node', label: 'CodexTurn', externalTurnId: 'turn-1', index: 2,
        startedAt: 10, completedAt: 20,
      },
      repository: {
        owner: 'rickycambrian', repository: 'repo', fullName: 'rickycambrian/repo',
        remoteUrl: 'https://github.com/rickycambrian/repo', branch: 'main', commitSha: 'a'.repeat(40),
      },
      entries: [
        { sequence: 1, eventType: 'Stop', receivedAt: 20, role: 'assistant-message', artifact: answer.ref },
        { sequence: 0, eventType: 'UserPromptSubmit', receivedAt: 10, role: 'human-prompt', artifact: prompt.ref },
      ],
    };

    const first = buildSessionArtifactManifestOperations(input);
    const second = buildSessionArtifactManifestOperations(input);

    expect(first).toEqual(second);
    expect(first.operations.map((operation) => operation.label)).toContain('SessionArtifactManifest');
    expect(first.operations.map((operation) => operation.edge_type)).toEqual(expect.arrayContaining([
      'HAS_ARTIFACT_MANIFEST',
      'INCLUDES_ARTIFACT',
    ]));
    const root = first.contentArtifacts.at(-1);
    expect(root?.value.contractVersion).toBe('content-artifact/v1');
    if (!root || root.value.contractVersion !== 'content-artifact/v1') throw new Error('expected inline manifest');
    const manifest = JSON.parse(root.value.content);
    expect(manifest.contractVersion).toBe(SESSION_ARTIFACT_MANIFEST_CONTRACT_VERSION);
    expect(manifest.entries.map((entry: { role: string }) => entry.role)).toEqual([
      'human-prompt',
      'assistant-message',
    ]);
    expect(root.value.content).not.toContain('What changed?');
    expect(root.value.content).not.toContain('The tests now pass.');
  });
});
