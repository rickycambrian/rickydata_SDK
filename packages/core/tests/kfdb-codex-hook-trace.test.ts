import { describe, expect, it } from 'vitest';
import { buildCodexHookTraceOperations } from '../src/kfdb/codex-hook-trace.js';

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
    expect(first.map((op) => op.edge_type)).toContain('HAS_CODEX_TURN');
    expect(first.map((op) => op.edge_type)).toContain('EMITTED_CODEX_HOOK');
    expect(first.map((op) => op.edge_type)).toContain('INVOKED_CODEX_TOOL');
  });
});
