import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasClient } from '../src/canvas/canvas-client.js';
import type { CanvasSSEEvent, CanvasWorkflowRequest } from '../src/canvas/types.js';

// ─── Helpers ────────────────────────────────────────────────

function createCanvasSSEStream(events: CanvasSSEEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map(e => `data: ${JSON.stringify(e)}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function createDelayedStream(
  events: CanvasSSEEvent[],
  delayMs: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const event of events) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function createStallingStream(
  initialEvents: CanvasSSEEvent[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of initialEvents) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      // Stream stalls — never closes, never sends more data
    },
  });
}

function createNeverClosingStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    // Never enqueues anything, never closes
    start() {},
  });
}

const mockAuth = {
  fetchWithAuth: vi.fn(),
} as unknown as import('../src/auth.js').AuthManager;

function makeClient(): CanvasClient {
  return new CanvasClient({ auth: mockAuth, baseUrl: 'https://test.example.com' });
}

const SAMPLE_REQUEST: CanvasWorkflowRequest = {
  nodes: [{ id: 'n1', type: 'text-input', data: { value: 'hello' } }],
  connections: [],
};

// ─── Tests ──────────────────────────────────────────────────

describe('CanvasClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ─── executeWorkflow basic ─────────────────────────────

  describe('executeWorkflow', () => {
    it('yields SSE events from a normal stream', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
        { type: 'run_completed', data: { runId: 'r1', status: 'completed', results: {}, logs: [], completedAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createCanvasSSEStream(events),
      } as unknown as Response);

      const client = makeClient();
      const received: CanvasSSEEvent[] = [];
      for await (const event of client.executeWorkflow(SAMPLE_REQUEST)) {
        received.push(event);
      }

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe('run_started');
      expect(received[1].type).toBe('run_completed');
    });

    it('throws on non-OK response', async () => {
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as unknown as Response);

      const client = makeClient();
      await expect(async () => {
        for await (const _event of client.executeWorkflow(SAMPLE_REQUEST)) {
          // consume
        }
      }).rejects.toThrow('Canvas workflow execution failed: 500');
    });

    it('throws on missing response body', async () => {
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: null,
      } as unknown as Response);

      const client = makeClient();
      await expect(async () => {
        for await (const _event of client.executeWorkflow(SAMPLE_REQUEST)) {
          // consume
        }
      }).rejects.toThrow('No response body');
    });

    it('accepts a bare AbortSignal for backward compatibility', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createCanvasSSEStream(events),
      } as unknown as Response);

      const client = makeClient();
      const controller = new AbortController();
      const received: CanvasSSEEvent[] = [];
      for await (const event of client.executeWorkflow(SAMPLE_REQUEST, controller.signal)) {
        received.push(event);
      }

      expect(received).toHaveLength(1);
    });

    it('stops on error events', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
        { type: 'error', data: { message: 'something went wrong' } },
        { type: 'run_completed', data: { runId: 'r1', status: 'completed', results: {}, logs: [], completedAt: '2025-01-01' } },
      ];

      // Don't use createCanvasSSEStream since it adds [DONE]; build manually
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const event of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          controller.close();
        },
      });

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: stream,
      } as unknown as Response);

      const client = makeClient();
      const received: CanvasSSEEvent[] = [];
      for await (const event of client.executeWorkflow(SAMPLE_REQUEST)) {
        received.push(event);
      }

      // Should stop after error, not yield run_completed
      expect(received).toHaveLength(2);
      expect(received[1].type).toBe('error');
    });
  });

  // ─── Timeout ───────────────────────────────────────────

  describe('timeout', () => {
    it('aborts after timeoutMs', async () => {
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createNeverClosingStream(),
      } as unknown as Response);

      const client = makeClient();
      await expect(async () => {
        for await (const _event of client.executeWorkflow(SAMPLE_REQUEST, { timeoutMs: 100 })) {
          // consume
        }
      }).rejects.toThrow(/timed out after 100ms/);
    }, 2000);

    it('completes normally when stream finishes before timeout', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createCanvasSSEStream(events),
      } as unknown as Response);

      const client = makeClient();
      const received: CanvasSSEEvent[] = [];
      for await (const event of client.executeWorkflow(SAMPLE_REQUEST, { timeoutMs: 5000 })) {
        received.push(event);
      }

      expect(received).toHaveLength(1);
    });
  });

  // ─── Heartbeat ─────────────────────────────────────────

  describe('heartbeat', () => {
    it('aborts when stream stalls beyond heartbeat timeout', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createStallingStream(events),
      } as unknown as Response);

      const client = makeClient();
      await expect(async () => {
        for await (const _event of client.executeWorkflow(SAMPLE_REQUEST, { heartbeatTimeoutMs: 100 })) {
          // consume
        }
      }).rejects.toThrow(/idle for 100ms/);
    }, 2000);

    it('resets heartbeat on each received chunk', async () => {
      // Events arrive every 30ms, heartbeat at 80ms — should complete fine
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
        { type: 'node_started', data: { runId: 'r1', nodeId: 'n1', nodeType: 'text-input', status: 'running' } },
        { type: 'run_completed', data: { runId: 'r1', status: 'completed', results: {}, logs: [], completedAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createDelayedStream(events, 30),
      } as unknown as Response);

      const client = makeClient();
      const received: CanvasSSEEvent[] = [];
      for await (const event of client.executeWorkflow(SAMPLE_REQUEST, { heartbeatTimeoutMs: 80 })) {
        received.push(event);
      }

      expect(received).toHaveLength(3);
    }, 2000);
  });

  // ─── Caller abort signal ──────────────────────────────

  describe('caller abort signal', () => {
    it('respects a pre-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort(new Error('cancelled'));

      vi.mocked(mockAuth.fetchWithAuth).mockRejectedValueOnce(
        new DOMException('The operation was aborted', 'AbortError'),
      );

      const client = makeClient();
      await expect(async () => {
        for await (const _event of client.executeWorkflow(SAMPLE_REQUEST, { signal: controller.signal })) {
          // consume
        }
      }).rejects.toThrow();
    });

    it('caller signal takes precedence over timeout', async () => {
      const controller = new AbortController();

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createNeverClosingStream(),
      } as unknown as Response);

      const client = makeClient();
      // Abort after 50ms, but timeout is 5000ms
      setTimeout(() => controller.abort(new Error('user cancelled')), 50);

      await expect(async () => {
        for await (const _event of client.executeWorkflow(SAMPLE_REQUEST, {
          signal: controller.signal,
          timeoutMs: 5000,
        })) {
          // consume
        }
      }).rejects.toThrow(/user cancelled/);
    }, 2000);
  });

  // ─── executeWorkflowSync ──────────────────────────────

  describe('executeWorkflowSync', () => {
    it('collects events and returns aggregated result', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
        { type: 'node_log', data: { runId: 'r1', message: 'Processing...' } },
        { type: 'run_completed', data: { runId: 'r1', status: 'completed', results: { out: 'done' }, logs: ['final'], completedAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createCanvasSSEStream(events),
      } as unknown as Response);

      const client = makeClient();
      const result = await client.executeWorkflowSync(SAMPLE_REQUEST);

      expect(result.runId).toBe('r1');
      expect(result.status).toBe('completed');
      expect(result.results).toEqual({ out: 'done' });
      expect(result.logs).toContain('Processing...');
      expect(result.logs).toContain('final');
      expect(result.events).toHaveLength(3);
    });

    it('threads timeoutMs through to executeWorkflow', async () => {
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createNeverClosingStream(),
      } as unknown as Response);

      const client = makeClient();
      await expect(
        client.executeWorkflowSync(SAMPLE_REQUEST, { timeoutMs: 100 }),
      ).rejects.toThrow(/timed out after 100ms/);
    }, 2000);

    it('calls onEvent for each event', async () => {
      const events: CanvasSSEEvent[] = [
        { type: 'run_started', data: { runId: 'r1', status: 'running', createdAt: '2025-01-01' } },
      ];

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        body: createCanvasSSEStream(events),
      } as unknown as Response);

      const onEvent = vi.fn();
      const client = makeClient();
      await client.executeWorkflowSync(SAMPLE_REQUEST, { onEvent });

      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'run_started' }));
    });
  });

  // ─── getRun ────────────────────────────────────────────

  describe('getRun', () => {
    it('returns run state on success', async () => {
      const runState = { runId: 'r1', status: 'completed', nodeStatuses: {}, nodeResults: {}, approvals: [], logs: [], createdAt: '', updatedAt: '', walletAddress: '0x' };
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(runState),
      } as unknown as Response);

      const client = makeClient();
      const result = await client.getRun('r1');
      expect(result.runId).toBe('r1');
    });

    it('throws on empty runId', async () => {
      const client = makeClient();
      await expect(client.getRun('')).rejects.toThrow('runId is required');
    });
  });

  // ─── getRunWithRetry ──────────────────────────────────

  describe('getRunWithRetry', () => {
    it('returns on first success', async () => {
      const runState = { runId: 'r1', status: 'completed', nodeStatuses: {}, nodeResults: {}, approvals: [], logs: [], createdAt: '', updatedAt: '', walletAddress: '0x' };
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(runState),
      } as unknown as Response);

      const client = makeClient();
      const result = await client.getRunWithRetry('r1');
      expect(result.runId).toBe('r1');
      expect(mockAuth.fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it('retries on 404 and succeeds on third attempt', async () => {
      const runState = { runId: 'r1', status: 'completed', nodeStatuses: {}, nodeResults: {}, approvals: [], logs: [], createdAt: '', updatedAt: '', walletAddress: '0x' };

      // First two calls: 404
      vi.mocked(mockAuth.fetchWithAuth)
        .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('Not Found') } as unknown as Response)
        .mockResolvedValueOnce({ ok: false, status: 404, text: () => Promise.resolve('Not Found') } as unknown as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(runState) } as unknown as Response);

      const client = makeClient();
      const result = await client.getRunWithRetry('r1', { initialDelayMs: 10 });
      expect(result.runId).toBe('r1');
      expect(mockAuth.fetchWithAuth).toHaveBeenCalledTimes(3);
    }, 5000);

    it('throws immediately on non-404 errors', async () => {
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      } as unknown as Response);

      const client = makeClient();
      await expect(client.getRunWithRetry('r1', { initialDelayMs: 10 })).rejects.toThrow('500');
      expect(mockAuth.fetchWithAuth).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting all attempts', async () => {
      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as unknown as Response);

      const client = makeClient();
      await expect(
        client.getRunWithRetry('r1', { maxAttempts: 3, initialDelayMs: 10 }),
      ).rejects.toThrow('404');
      expect(mockAuth.fetchWithAuth).toHaveBeenCalledTimes(3);
    }, 5000);

    it('respects aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();

      vi.mocked(mockAuth.fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as unknown as Response);

      const client = makeClient();
      await expect(
        client.getRunWithRetry('r1', { initialDelayMs: 10, signal: controller.signal }),
      ).rejects.toThrow('404');
      // Should not retry because signal is aborted
      expect(mockAuth.fetchWithAuth).toHaveBeenCalledTimes(1);
    });
  });
});
