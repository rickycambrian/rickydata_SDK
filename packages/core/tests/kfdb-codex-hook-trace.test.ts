import { describe, expect, it } from 'vitest';
import { buildCodexHookTraceOperations, buildCodexHookTraceWriteBundle } from '../src/kfdb/codex-hook-trace.js';

describe('buildCodexHookTraceOperations', () => {
  it('creates deterministic private KG operations from Codex hook records', () => {
    const trace = {
      walletAddress: '0x75992f829DF3B5d515D70DB0f77A98171cE261EF',
      agentId: 'erc8004-expert',
      sessionId: 'session-1',
      turnIndex: 2,
      codexSessionId: 'codex-session-1',
      turnId: 'turn-1',
      model: 'gpt-5.3-codex',
      cwd: '/workspace',
      startedAt: 1_765_000_000_000,
      completedAt: 1_765_000_001_000,
      repository: { owner: 'rickycambrian', repository: 'repo', fullName: 'rickycambrian/repo', remoteUrl: 'git@github.com:rickycambrian/repo.git', branch: 'main', commitSha: 'a'.repeat(40) },
      events: [
        {
          sequence: 0,
          hookEventName: 'UserPromptSubmit',
          codexSessionId: 'codex-session-1',
          turnId: 'turn-1',
          model: 'gpt-5.3-codex',
          cwd: '/workspace',
          receivedAt: 1_765_000_000_000,
          prompt: 'Use Codex hooks to write private KG traces.',
        },
        {
          sequence: 1,
          hookEventName: 'PostToolUse',
          codexSessionId: 'codex-session-1',
          turnId: 'turn-1',
          model: 'gpt-5.3-codex',
          cwd: '/workspace',
          receivedAt: 1_765_000_000_500,
          toolName: 'Bash',
          toolUseId: 'tool-1',
          toolInput: { command: 'npm test' },
          toolResponse: { exitCode: 0, stdout: 'pass' },
        },
        {
          sequence: 2,
          hookEventName: 'Stop',
          codexSessionId: 'codex-session-1',
          turnId: 'turn-1',
          model: 'gpt-5.3-codex',
          cwd: '/workspace',
          receivedAt: 1_765_000_001_000,
          lastAssistantMessage: 'The implementation is ready.',
        },
      ],
    };

    const first = buildCodexHookTraceOperations(trace);
    const second = buildCodexHookTraceOperations(trace);

    expect(first).toEqual(second);
    expect(first.map((op) => op.label)).toContain('CodexSession');
    expect(first.map((op) => op.label)).toContain('CodexTurn');
    expect(first.map((op) => op.label)).toContain('CodexHookEvent');
    expect(first.map((op) => op.label)).toContain('CodexToolUse');
    expect(first.map((op) => op.label)).toContain('CodeWorkspace');
    expect(first.map((op) => op.label)).toContain('CodeCommand');
    expect(first.map((op) => op.edge_type)).toContain('HAS_CODEX_TURN');
    expect(first.map((op) => op.edge_type)).toContain('EMITTED_CODEX_HOOK');
    expect(first.map((op) => op.edge_type)).toContain('INVOKED_CODEX_TOOL');
    expect(first.map((op) => op.edge_type)).toContain('RAN_IN_WORKSPACE');
    expect(first.map((op) => op.edge_type)).toContain('RAN_COMMAND');
    const bundle = buildCodexHookTraceWriteBundle(trace);
    const persistedContent = bundle.contentArtifacts.flatMap((artifact) => artifact.value.contractVersion === 'content-artifact/v1' ? [artifact.value.content] : []);
    expect(persistedContent).toEqual(expect.arrayContaining(['Use Codex hooks to write private KG traces.', 'The implementation is ready.']));
    expect(bundle.contentArtifacts.every((artifact) => artifact.ifAbsent)).toBe(true);
    expect(bundle.operations.map((operation) => operation.label)).toContain('SessionArtifactManifest');
    expect(bundle.operations.map((operation) => operation.edge_type)).toContain('HAS_ARTIFACT_MANIFEST');
    const session = first.find((op) => op.label === 'CodexSession') as { properties?: Record<string, unknown> };
    expect(session.properties?.repository).toEqual(expect.objectContaining({ Object: expect.any(Object) }));
  });

  it('emits a canonical DecisionObservation for AskUser choices', () => {
    const bundle = buildCodexHookTraceWriteBundle({
      walletAddress: '0xabc', agentId: 'codex', sessionId: 's', codexSessionId: 's', turnId: 't', turnIndex: 1,
      startedAt: 1, completedAt: 2,
      events: [{
        sequence: 0, hookEventName: 'PostToolUse', codexSessionId: 's', receivedAt: 2,
        toolName: 'AskUserQuestion', toolUseId: 'ask-1', toolInput: { question: 'Ship?' }, toolResponse: { answer: 'yes' },
        decisionKind: 'ask_user', decisionQuestion: 'Ship?', decisionOptions: ['yes', 'no'], decisionAnswer: 'yes',
      }],
    });
    expect(bundle.operations.map((op) => op.label)).toContain('DecisionObservation');
    expect(bundle.operations.map((op) => op.edge_type)).toContain('OBSERVED_IN_SESSION');
    const persistedContent = bundle.contentArtifacts.flatMap((artifact) => artifact.value.contractVersion === 'content-artifact/v1' ? [artifact.value.content] : []);
    expect(persistedContent).toEqual(expect.arrayContaining(['Ship?', '["yes","no"]', 'yes']));
  });
});
