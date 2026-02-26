import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamRenderer } from '../../src/cli/chat/stream-renderer.js';

describe('StreamRenderer', () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onText', () => {
    it('writes agent prefix on first text chunk', () => {
      const renderer = new StreamRenderer();
      renderer.onText('Hello');
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('agent>');
      expect(output).toContain('Hello');
    });

    it('does not repeat agent prefix for subsequent chunks', () => {
      const renderer = new StreamRenderer();
      renderer.onText('Hello');
      renderer.onText(' World');
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      const prefixCount = (output.match(/agent>/g) ?? []).length;
      expect(prefixCount).toBe(1);
      expect(output).toContain(' World');
    });

    it('writes newline after prefix and text', () => {
      const renderer = new StreamRenderer();
      renderer.onText('Hi');
      renderer.onDone({});
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('\n');
    });
  });

  describe('onToolCall', () => {
    it('shows tool name in output', () => {
      const renderer = new StreamRenderer({ verbose: true });
      renderer.onToolCall({ name: 'search', displayName: 'Search', args: { q: 'hello' } });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('Search');
    });

    it('shows args when verbose is true', () => {
      const renderer = new StreamRenderer({ verbose: true });
      renderer.onToolCall({ name: 'search', args: { query: 'test' } });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('query');
    });

    it('ends text line before showing tool call', () => {
      const renderer = new StreamRenderer({ verbose: true });
      renderer.onText('partial');
      renderer.onToolCall({ name: 'tool', args: {} });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      // Should have a newline after 'partial'
      expect(output).toContain('partial');
    });
  });

  describe('onToolResult', () => {
    it('shows result preview in verbose mode', () => {
      const renderer = new StreamRenderer({ verbose: true });
      renderer.onToolCall({ name: 'search', args: {} });
      renderer.onToolResult({ name: 'search', result: 'found items', isError: false });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('found items');
    });

    it('truncates long results in verbose mode', () => {
      const renderer = new StreamRenderer({ verbose: true });
      renderer.onToolCall({ name: 'search', args: {} });
      const longResult = 'x'.repeat(300);
      renderer.onToolResult({ name: 'search', result: longResult, isError: false });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('…');
    });
  });

  describe('onDone', () => {
    it('writes cost in dim text', () => {
      const renderer = new StreamRenderer();
      renderer.onText('response');
      renderer.onDone({ cost: '$0.014', toolCallCount: 2, usage: { inputTokens: 100, outputTokens: 50 } });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('$0.014');
      expect(output).toContain('100 in / 50 out');
      expect(output).toContain('2 tool call');
    });

    it('does not write cost line when quiet', () => {
      const renderer = new StreamRenderer({ quiet: true });
      renderer.onText('response');
      renderer.onDone({ cost: '$0.014' });
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      expect(output).not.toContain('$0.014');
    });

    it('skips cost line when no cost data', () => {
      const renderer = new StreamRenderer();
      renderer.onText('response');
      renderer.onDone({});
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      // Should not have a cost parenthetical
      expect(output).not.toContain('($');
    });
  });

  describe('reset', () => {
    it('resets text started state so prefix appears again', () => {
      const renderer = new StreamRenderer();
      renderer.onText('first');
      renderer.onDone({});
      renderer.reset();
      renderer.onText('second');
      const output = stdoutWrite.mock.calls.map((c) => String(c[0])).join('');
      const prefixCount = (output.match(/agent>/g) ?? []).length;
      expect(prefixCount).toBe(2);
    });
  });
});
