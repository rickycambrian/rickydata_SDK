import { describe, it, expect } from 'vitest';
import { createSSEStream } from '../src/chat/mocks.js';
import type { SSEEvent } from '../src/chat/mocks.js';

// We can't import SSEEvent from rickydata/agent in tests without the full dep,
// so we define inline for test purposes.
type TestSSEEvent =
  | { type: 'text'; data: string }
  | { type: 'tool_call'; data: { name: string; args: unknown } }
  | { type: 'tool_result'; data: { name: string; isError: boolean; result?: string } }
  | { type: 'done'; data: Record<string, unknown> }
  | { type: 'error'; data: { message: string } };

describe('createSSEStream', () => {
  it('produces valid SSE format with data: prefix and double newlines', async () => {
    const events: TestSSEEvent[] = [
      { type: 'text', data: 'Hello ' },
      { type: 'text', data: 'world!' },
      { type: 'done', data: { cost: '$0.001' } },
    ];

    const stream = createSSEStream(events as unknown as SSEEvent[]);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // Each event should be "data: {...}\n\n"
    const lines = fullText.split('\n\n').filter(Boolean);
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      expect(line.startsWith('data: ')).toBe(true);
      const json = JSON.parse(line.slice(6));
      expect(json).toHaveProperty('type');
    }
  });

  it('produces parseable JSON in each SSE line', async () => {
    const events: TestSSEEvent[] = [
      { type: 'tool_call', data: { name: 'brave_search', args: { query: 'test' } } },
      { type: 'tool_result', data: { name: 'brave_search', isError: false, result: 'results' } },
      { type: 'done', data: {} },
    ];

    const stream = createSSEStream(events as unknown as SSEEvent[]);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    const parsed = fullText
      .split('\n\n')
      .filter(Boolean)
      .map(line => JSON.parse(line.replace('data: ', '')));

    expect(parsed[0]).toEqual({ type: 'tool_call', data: { name: 'brave_search', args: { query: 'test' } } });
    expect(parsed[1].type).toBe('tool_result');
    expect(parsed[2].type).toBe('done');
  });

  it('handles empty events array', async () => {
    const stream = createSSEStream([] as unknown as SSEEvent[]);
    const reader = stream.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });
});
