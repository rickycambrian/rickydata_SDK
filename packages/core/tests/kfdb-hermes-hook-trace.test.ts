import { describe, expect, it } from 'vitest';
import { buildHermesHookTraceOperations, createHermesHookTraceFixture } from '../src/kfdb/hermes-hook-trace.js';

const walletAddress = '0x75992f829DF3B5d515D70DB0f77A98171cE261EF';

describe('Hermes hook KFDB trace builder', () => {
  it('builds deterministic Hermes session, turn, event, tool, workspace, file, and command graph operations', () => {
    const trace = createHermesHookTraceFixture(walletAddress);
    const a = buildHermesHookTraceOperations(trace);
    const b = buildHermesHookTraceOperations(trace);

    expect(a).toEqual(b);
    const labels = a.map((op) => op.label).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining([
      'WalletTenant',
      'Agent',
      'HermesSession',
      'HermesTurn',
      'HermesHookEvent',
      'HermesToolUse',
      'ExecutionEngine',
      'Model',
      'CodeWorkspace',
      'CodeFile',
    ]));

    const edges = a.map((op) => op.edge_type).filter(Boolean);
    expect(edges).toEqual(expect.arrayContaining([
      'OWNS_EXECUTION_SESSION',
      'EXECUTES_AGENT',
      'HAS_HERMES_TURN',
      'EMITTED_HERMES_HOOK',
      'INVOKED_HERMES_TOOL',
      'USES_EXECUTION_ENGINE',
      'USES_MODEL',
      'RAN_IN_WORKSPACE',
      'TOUCHED_FILE',
    ]));
  });

  it('stores content hashes and lengths instead of raw prompt/response text', () => {
    const rawPrompt = 'sensitive user prompt that should not be stored raw';
    const rawResponse = 'assistant response body that should not be stored raw';
    const operations = buildHermesHookTraceOperations({
      walletAddress,
      agentId: 'agent:hermes',
      sessionId: 'session-1',
      turnIndex: 1,
      hermesSessionId: 'session-1',
      provider: 'openai-codex',
      model: 'gpt-5.5',
      startedAt: 1,
      completedAt: 3,
      events: [
        { sequence: 0, hookEventName: 'agent:start', hermesSessionId: 'session-1', receivedAt: 1, messageRole: 'user', message: rawPrompt },
        { sequence: 1, hookEventName: 'agent:end', hermesSessionId: 'session-1', receivedAt: 3, messageRole: 'assistant', response: rawResponse },
      ],
    });
    const encoded = JSON.stringify(operations);
    expect(encoded).not.toContain(rawPrompt);
    expect(encoded).not.toContain(rawResponse);
    expect(encoded).toContain('messageHash');
    expect(encoded).toContain('responseHash');
  });

  it('projects Hermes slash commands and terminal tool inputs into command nodes', () => {
    const operations = buildHermesHookTraceOperations({
      walletAddress,
      agentId: 'agent:hermes',
      sessionId: 'session-2',
      turnIndex: 2,
      hermesSessionId: 'session-2',
      startedAt: 1,
      completedAt: 2,
      events: [
        { sequence: 0, hookEventName: 'command:status', hermesSessionId: 'session-2', receivedAt: 1, commandName: 'status', commandArgs: '--all' },
        { sequence: 1, hookEventName: 'agent:step', hermesSessionId: 'session-2', receivedAt: 2, toolName: 'terminal', toolUseId: 'tool-1', toolInput: { command: 'pwd' }, toolResponse: '/tmp' },
      ],
    });
    expect(operations.some((op) => op.label === 'CodeCommand')).toBe(true);
    expect(operations.some((op) => op.edge_type === 'RAN_COMMAND')).toBe(true);
  });
});
