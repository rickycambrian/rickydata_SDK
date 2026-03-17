import { describe, it, expect } from 'vitest';
import { VoiceSessionSimulator } from '../src/voice/session-simulator.js';
import type { VoiceTestScenario } from '../src/voice/types.js';

const basicScenario: VoiceTestScenario = {
  name: 'Basic tool call flow',
  dataChannelMessages: [
    { type: 'tool_call_started', callId: 'tc-1', name: 'mcp__geo__get_page_content', delayMs: 1000 },
    { type: 'tool_call_completed', callId: 'tc-1', success: true, result: 'page content', delayMs: 3000 },
    { type: 'agent_text', text: 'Here is what I found...', delayMs: 500 },
  ],
};

const multiToolScenario: VoiceTestScenario = {
  name: 'Multiple tool calls',
  dataChannelMessages: [
    { type: 'tool_call_started', callId: 'tc-1', name: 'mcp__geo__search', delayMs: 500 },
    { type: 'tool_call_started', callId: 'tc-2', name: 'mcp__geo__get_page_content', delayMs: 200 },
    { type: 'tool_call_completed', callId: 'tc-1', success: true, delayMs: 2000 },
    { type: 'tool_call_completed', callId: 'tc-2', success: false, delayMs: 1000 },
    { type: 'session_cost', cost: '$0.05', delayMs: 100 },
  ],
};

describe('VoiceSessionSimulator', () => {
  it('tracks tool calls from a basic scenario', async () => {
    const sim = new VoiceSessionSimulator();
    const result = await sim.runScenario(basicScenario);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].callId).toBe('tc-1');
    expect(result.toolCalls[0].name).toBe('mcp__geo__get_page_content');
    expect(result.toolCalls[0].success).toBe(true);
  });

  it('generates narrations for tool calls', async () => {
    const sim = new VoiceSessionSimulator();
    const result = await sim.runScenario(basicScenario);

    expect(result.narrations).toContain('Let me get page content...');
    expect(result.narrations).toContain('Got the results.');
  });

  it('tracks phase transitions', async () => {
    const sim = new VoiceSessionSimulator();
    const result = await sim.runScenario(basicScenario);

    expect(result.phases).toContain('idle');
    expect(result.phases).toContain('connecting');
    expect(result.phases).toContain('using_tools');
    expect(result.phases).toContain('speaking');
  });

  it('handles multiple concurrent tool calls', async () => {
    const sim = new VoiceSessionSimulator();
    const result = await sim.runScenario(multiToolScenario);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].success).toBe(true);
    expect(result.toolCalls[1].success).toBe(false);
  });

  it('calculates cost from duration and tool calls', async () => {
    const sim = new VoiceSessionSimulator();
    const result = await sim.runScenario(basicScenario);

    expect(result.costSnapshot.toolCalls).toBe(1);
    expect(result.costSnapshot.durationMin).toBeGreaterThan(0);
    expect(result.costSnapshot.totalEstimated).toBeGreaterThan(0);
  });

  it('generates error narration for failed tool calls', async () => {
    const sim = new VoiceSessionSimulator();
    const result = await sim.runScenario(multiToolScenario);

    expect(result.narrations).toContain("That didn't work as expected.");
  });

  it('accepts custom fee config', async () => {
    const sim = new VoiceSessionSimulator({ perMinuteUsd: 0.10, perToolCallUsd: 0.01 });
    const result = await sim.runScenario(basicScenario);

    // With higher fees, total should be higher
    expect(result.costSnapshot.totalEstimated).toBeGreaterThan(0);
    // Verify tool call fee component
    expect(result.costSnapshot.toolCallFee).toBeCloseTo(0.01, 4);
  });
});
