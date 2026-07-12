import { describe, expect, it } from 'vitest';
import { buildClaudeCodeHookTraceOperations, claudeCodeSessionNodeId, type ClaudeCodeHookTrace } from '../src/kfdb/claude-code-hook-trace.js';

function baseTrace(): ClaudeCodeHookTrace {
  return {
    walletAddress: '0x75992f829DF3B5d515D70DB0f77A98171cE261EF',
    agentId: 'erc8004-expert',
    sessionId: 'session-1',
    turnIndex: 2,
    claudeSessionId: 'claude-session-1',
    model: 'claude-sonnet-4-6',
    cwd: '/workspace',
    startedAt: 1_765_000_000_000,
    completedAt: 1_765_000_001_000,
    events: [
      { sequence: 0, hookEventName: 'SessionStart', claudeSessionId: 'claude-session-1', cwd: '/workspace', receivedAt: 1_765_000_000_000, source: 'startup' },
    ],
  };
}

function sessionProps(trace: ClaudeCodeHookTrace): Record<string, unknown> {
  const ops = buildClaudeCodeHookTraceOperations(trace);
  const node = ops.find((op) => op.label === 'ClaudeCodeSession') as Record<string, unknown>;
  return node.properties as Record<string, unknown>;
}

describe('buildClaudeCodeHookTraceOperations pass-through fields', () => {
  it('omits pass-through node properties when the fields are absent', () => {
    const props = sessionProps(baseTrace());
    expect('files_changed' in props).toBe(false);
    expect('parent_session_id' in props).toBe(false);
    expect('initial_prompt' in props).toBe(false);
  });

  it('sets files_changed only when filesChanged is provided', () => {
    const props = sessionProps({ ...baseTrace(), filesChanged: 7 });
    expect(props.files_changed).toEqual({ Integer: 7 });
    expect('parent_session_id' in props).toBe(false);
    expect('initial_prompt' in props).toBe(false);
  });

  it('sets parent_session_id only when parentSessionId is provided', () => {
    const props = sessionProps({ ...baseTrace(), parentSessionId: 'claude-session-0' });
    expect(props.parent_session_id).toEqual({ String: 'claude-session-0' });
    expect('files_changed' in props).toBe(false);
  });

  it('sets initial_prompt only when initialPrompt is provided', () => {
    const props = sessionProps({ ...baseTrace(), initialPrompt: 'do the thing' });
    expect(props.initial_prompt).toEqual({ String: 'do the thing' });
  });

  it('sets all three when provided together and stays deterministic', () => {
    const trace: ClaudeCodeHookTrace = { ...baseTrace(), filesChanged: 3, parentSessionId: 'p-1', initialPrompt: 'hello' };
    const first = buildClaudeCodeHookTraceOperations(trace);
    const second = buildClaudeCodeHookTraceOperations(trace);
    expect(first).toEqual(second);
    const node = first.find((op) => op.label === 'ClaudeCodeSession') as Record<string, unknown>;
    const props = node.properties as Record<string, unknown>;
    expect(props.files_changed).toEqual({ Integer: 3 });
    expect(props.parent_session_id).toEqual({ String: 'p-1' });
    expect(props.initial_prompt).toEqual({ String: 'hello' });
  });

  it('claudeCodeSessionNodeId matches the session node op id emitted by the builder', () => {
    const trace = baseTrace();
    const ops = buildClaudeCodeHookTraceOperations(trace);
    const node = ops.find((op) => op.label === 'ClaudeCodeSession') as Record<string, unknown>;
    expect(claudeCodeSessionNodeId(trace)).toBe(node.id);
  });

  it('claudeCodeSessionNodeId only needs the identity fields (Pick) and is wallet case-insensitive', () => {
    const trace = baseTrace();
    const picked = { walletAddress: trace.walletAddress, agentId: trace.agentId, sessionId: trace.sessionId, claudeSessionId: trace.claudeSessionId };
    const lowerWallet = { ...picked, walletAddress: trace.walletAddress.toLowerCase() };
    expect(claudeCodeSessionNodeId(picked)).toBe(claudeCodeSessionNodeId(lowerWallet));
  });

  it('does not alter existing emitted properties when pass-through fields are absent', () => {
    const props = sessionProps(baseTrace());
    expect(props.agent_id).toEqual({ String: 'erc8004-expert' });
    expect(props.session_id).toEqual({ String: 'session-1' });
    expect(props.claude_session_id).toEqual({ String: 'claude-session-1' });
    expect(props.wallet_address).toEqual({ String: '0x75992f829df3b5d515d70db0f77a98171ce261ef' });
    expect(props.source).toEqual({ String: 'claude-code-hooks' });
    expect(props.schema_version).toEqual({ Integer: 3 });
    expect(props.updated_at).toEqual({ Integer: 1_765_000_001_000 });
  });
});
