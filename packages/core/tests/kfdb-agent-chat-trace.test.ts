import { describe, expect, it } from 'vitest';
import { buildAgentChatTraceOperations } from '../src/kfdb/agent-chat-trace.js';

describe('buildAgentChatTraceOperations', () => {
  it('creates deterministic private KG operations', () => {
    const trace = {
      walletAddress: '0x75992f829DF3B5d515D70DB0f77A98171cE261EF',
      agentId: 'erc8004-expert',
      sessionId: '11111111-1111-4111-8111-111111111111',
      turnIndex: 1,
      userMessage: 'What is ERC-8004?',
      assistantText: 'ERC-8004 is an agent trust protocol.',
      model: 'MiniMax-M2.7',
      provider: 'minimax',
      executionEngine: 'claude',
      startedAt: 1_765_000_000_000,
      completedAt: 1_765_000_001_000,
      toolCallCount: 1,
      events: [{ type: 'done', data: { model: 'MiniMax-M2.7', toolCallCount: 1 } }],
    };

    expect(buildAgentChatTraceOperations(trace)).toEqual(buildAgentChatTraceOperations(trace));
    expect(buildAgentChatTraceOperations(trace).map((op) => op.label)).toContain('AgentChatTurn');
    expect(buildAgentChatTraceOperations(trace).map((op) => op.edge_type)).toContain('HAS_TURN');
  });
});
