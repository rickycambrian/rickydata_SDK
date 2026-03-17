import { describe, it, expect, vi } from 'vitest';
import { ChatTestRunner } from '../src/chat/test-runner.js';
import { ConsoleReporter } from '../src/common/reporter.js';
import type { ChatTestCase } from '../src/chat/types.js';

// Mock AgentClient
function createMockClient(response?: Partial<{
  text: string;
  sessionId: string;
  cost: string;
  toolCallCount: number;
}>) {
  const defaults = {
    text: 'Governance has personal and public spaces with editor and voting roles.',
    sessionId: 'sess-mock-1',
    cost: '$0.010',
    toolCallCount: 1,
  };
  const result = { ...defaults, ...response };

  return {
    chat: vi.fn(async (_agentId: string, _message: string, options?: {
      onText?: (t: string) => void;
      onToolCall?: (tc: { name: string; displayName?: string; args: unknown }) => void;
      onToolResult?: (r: { name: string; result?: string; isError: boolean }) => void;
    }) => {
      // Simulate streaming callbacks
      options?.onText?.(result.text);
      options?.onToolCall?.({ name: 'mcp__geo__get_page_content', args: { entityId: 'abc' } });
      options?.onToolResult?.({ name: 'mcp__geo__get_page_content', result: 'entity-abc governance', isError: false });
      return result;
    }),
  };
}

const passingTest: ChatTestCase = {
  name: 'Governance test',
  agentId: 'geo-expert',
  question: 'What is governance?',
  validation: {
    requiredTools: ['get_page_content'],
    requiredKeywords: ['governance'],
  },
};

const failingTest: ChatTestCase = {
  name: 'Missing keyword test',
  agentId: 'geo-expert',
  question: 'Tell me about bounties',
  validation: {
    requiredKeywords: ['bounties', 'payout', 'difficulty'],
  },
};

describe('ChatTestRunner', () => {
  describe('runTest', () => {
    it('returns passing result for valid test case', async () => {
      const client = createMockClient();
      const reporter = new ConsoleReporter();
      vi.spyOn(reporter, 'testStart');
      vi.spyOn(reporter, 'testPass');

      const runner = new ChatTestRunner({ client, reporter });
      const result = await runner.runTest(passingTest);

      expect(result.passed).toBe(true);
      expect(result.failures).toEqual([]);
      expect(result.toolCallCount).toBe(1);
      expect(reporter.testStart).toHaveBeenCalledWith('Governance test', 'What is governance?');
      expect(reporter.testPass).toHaveBeenCalled();
    });

    it('returns failing result when keywords are missing', async () => {
      const client = createMockClient();
      const reporter = new ConsoleReporter();
      vi.spyOn(reporter, 'testFail');

      const runner = new ChatTestRunner({ client, reporter });
      const result = await runner.runTest(failingTest);

      expect(result.passed).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
      expect(reporter.testFail).toHaveBeenCalled();
    });

    it('handles client errors gracefully', async () => {
      const client = {
        chat: vi.fn().mockRejectedValue(new Error('Network timeout')),
      };
      const reporter = new ConsoleReporter();
      vi.spyOn(reporter, 'testError');

      const runner = new ChatTestRunner({ client, reporter });
      const result = await runner.runTest(passingTest);

      expect(result.passed).toBe(false);
      expect(result.failures).toContain('Network timeout');
      expect(reporter.testError).toHaveBeenCalled();
    });
  });

  describe('runSuite', () => {
    it('runs all test cases and returns summary', async () => {
      const client = createMockClient();
      const runner = new ChatTestRunner({ client });
      const summary = await runner.runSuite([passingTest, passingTest]);

      expect(summary.total).toBe(2);
      expect(summary.passed).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.totalElapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('respects stopOnFailure option', async () => {
      const client = createMockClient();
      const runner = new ChatTestRunner({ client });
      const summary = await runner.runSuite([failingTest, passingTest], { stopOnFailure: true });

      expect(summary.total).toBe(1);
      expect(summary.failed).toBe(1);
    });

    it('respects subset option', async () => {
      const client = createMockClient();
      const runner = new ChatTestRunner({ client });
      const tests = [passingTest, passingTest, passingTest, passingTest];
      const summary = await runner.runSuite(tests, { subset: 2 });

      expect(summary.total).toBe(2);
    });

    it('calls client.chat with correct agentId and question', async () => {
      const client = createMockClient();
      const runner = new ChatTestRunner({ client });
      await runner.runTest(passingTest);

      expect(client.chat).toHaveBeenCalledWith(
        'geo-expert',
        'What is governance?',
        expect.objectContaining({
          onText: expect.any(Function),
          onToolCall: expect.any(Function),
          onToolResult: expect.any(Function),
        }),
      );
    });
  });
});
