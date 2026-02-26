import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A2AClient, A2AError } from '../src/a2a/a2a-client.js';
import type {
  AgentCard,
  ExtendedAgentCard,
  Task,
  SendMessageRequest,
  TaskListResponse,
  StreamEvent,
} from '../src/a2a/types.js';

const BASE = 'https://agents.rickydata.org';

function mockAgentCard(): AgentCard {
  return {
    name: 'MCP Agent Gateway',
    description: 'Test gateway',
    url: BASE,
    version: '0.3',
    provider: { organization: 'MCP Gateway', url: BASE },
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    skills: [
      { id: 'research-agent', name: 'Research Agent', description: 'Web research', tags: ['haiku'] },
    ],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    securitySchemes: {
      walletAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    security: [{ walletAuth: [] }],
  };
}

function mockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task-123',
    status: {
      state: 'completed',
      message: {
        role: 'agent',
        parts: [{ type: 'text', text: 'Hello! How can I help?' }],
      },
      timestamp: '2026-02-13T10:00:00Z',
    },
    ...overrides,
  };
}

function mockSendRequest(text: string, agentId?: string, taskId?: string): SendMessageRequest {
  return {
    message: {
      role: 'user',
      parts: [{ type: 'text', text }],
    },
    metadata: {
      ...(agentId && { agentId }),
      ...(taskId && { taskId }),
    },
  };
}

/**
 * Create a ReadableStream that emits SSE-formatted data.
 */
function createSSEStream(events: StreamEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map(e => `data: ${JSON.stringify(e)}\n\n`);

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('A2AClient', () => {
  let client: A2AClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new A2AClient({ baseUrl: BASE, token: 'test-jwt' });
  });

  // ─── Discovery ─────────────────────────────────────────────

  describe('getAgentCard', () => {
    it('fetches the public agent card from well-known URL', async () => {
      const card = mockAgentCard();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(card),
      } as Response);

      const result = await client.getAgentCard();

      expect(result).toEqual(card);
      expect(fetch).toHaveBeenCalledWith(`${BASE}/.well-known/agent.json`);
    });

    it('does not send auth header for public card', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgentCard()),
      } as Response);

      await client.getAgentCard();

      // getAgentCard uses plain fetch with no headers
      const call = vi.mocked(fetch).mock.calls[0];
      expect(call.length).toBe(1); // no init argument
    });

    it('throws on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(client.getAgentCard()).rejects.toThrow('Failed to fetch agent card: 500');
    });
  });

  describe('getExtendedAgentCard', () => {
    it('fetches extended card with auth and A2A version header', async () => {
      const card: ExtendedAgentCard = {
        ...mockAgentCard(),
        user: { walletAddress: '0xabc', availableBalance: '5000000' },
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(card),
      } as Response);

      const result = await client.getExtendedAgentCard();

      expect(result.user?.walletAddress).toBe('0xabc');
      expect(result.user?.availableBalance).toBe('5000000');

      const call = vi.mocked(fetch).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-jwt');
      expect(headers['A2A-Version']).toBe('0.3');
    });

    it('works without auth token', async () => {
      const noAuthClient = new A2AClient({ baseUrl: BASE });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgentCard()),
      } as Response);

      await noAuthClient.getExtendedAgentCard();

      const call = vi.mocked(fetch).mock.calls[0];
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['A2A-Version']).toBe('0.3');
    });
  });

  // ─── Messaging ─────────────────────────────────────────────

  describe('sendMessage', () => {
    it('sends a message and returns completed task', async () => {
      const task = mockTask();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: task }),
      } as Response);

      const request = mockSendRequest('What is DeFi?', 'research-agent');
      const result = await client.sendMessage(request);

      expect(result.id).toBe('task-123');
      expect(result.status.state).toBe('completed');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/messages`);
      expect(call[1]?.method).toBe('POST');
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-jwt');
      expect(headers['A2A-Version']).toBe('0.3');

      const body = JSON.parse(call[1]?.body as string);
      expect(body.message.parts[0].text).toBe('What is DeFi?');
      expect(body.metadata.agentId).toBe('research-agent');
    });

    it('continues an existing task with taskId', async () => {
      const task = mockTask({ id: 'existing-task' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: task }),
      } as Response);

      const request = mockSendRequest('Tell me more', undefined, 'existing-task');
      const result = await client.sendMessage(request);

      expect(result.id).toBe('existing-task');

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.metadata.taskId).toBe('existing-task');
    });

    it('throws A2AError on JSON-RPC error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Task not found' },
        }),
      } as Response);

      await expect(client.sendMessage(mockSendRequest('test')))
        .rejects.toThrow(A2AError);

      try {
        await client.sendMessage(mockSendRequest('test'));
      } catch (e) {
        // Already thrown above, this block is for the first call
      }
    });

    it('throws on HTTP 402 insufficient balance', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Insufficient USDC balance' },
        })),
      } as Response);

      try {
        await client.sendMessage(mockSendRequest('test'));
        expect.unreachable('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(A2AError);
        expect((e as A2AError).code).toBe(-32603);
        expect((e as A2AError).message).toBe('Insufficient USDC balance');
      }
    });

    it('throws on HTTP 401 unauthorized', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      await expect(client.sendMessage(mockSendRequest('test')))
        .rejects.toThrow('A2A request failed: 401');
    });

    it('throws on non-JSON error body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      await expect(client.sendMessage(mockSendRequest('test')))
        .rejects.toThrow('A2A request failed: 500 Internal Server Error');
    });
  });

  describe('sendStreamingMessage', () => {
    it('streams task status and artifact events', async () => {
      const events: StreamEvent[] = [
        {
          id: 'task-1',
          status: { state: 'working', timestamp: '2026-02-13T10:00:00Z' },
          final: false,
        },
        {
          id: 'task-1',
          artifact: {
            parts: [{ type: 'text', text: 'Hello ' }],
            index: 0,
            append: false,
          },
        },
        {
          id: 'task-1',
          artifact: {
            parts: [{ type: 'text', text: 'world!' }],
            index: 1,
            append: true,
            lastChunk: true,
          },
        },
        {
          id: 'task-1',
          status: { state: 'completed', timestamp: '2026-02-13T10:00:01Z' },
          final: true,
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(events),
      } as unknown as Response);

      const request = mockSendRequest('Hello', 'research-agent');
      const collected: StreamEvent[] = [];
      for await (const event of client.sendStreamingMessage(request)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(4);
      expect('status' in collected[0] && collected[0].status.state).toBe('working');
      expect('artifact' in collected[1] && collected[1].artifact.parts[0]).toEqual({ type: 'text', text: 'Hello ' });
      expect('artifact' in collected[2] && collected[2].artifact.lastChunk).toBe(true);
      expect('status' in collected[3] && collected[3].final).toBe(true);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/messages:stream`);
    });

    it('handles empty stream gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body: createSSEStream([]),
      } as unknown as Response);

      const collected: StreamEvent[] = [];
      for await (const event of client.sendStreamingMessage(mockSendRequest('test'))) {
        collected.push(event);
      }
      expect(collected).toHaveLength(0);
    });

    it('handles null body gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body: null,
      } as unknown as Response);

      const collected: StreamEvent[] = [];
      for await (const event of client.sendStreamingMessage(mockSendRequest('test'))) {
        collected.push(event);
      }
      expect(collected).toHaveLength(0);
    });

    it('skips malformed JSON in SSE events', async () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"id":"t1","status":{"state":"working","timestamp":"now"},"final":false}\n\n'));
          controller.enqueue(encoder.encode('data: {INVALID JSON}\n\n'));
          controller.enqueue(encoder.encode('data: {"id":"t1","status":{"state":"completed","timestamp":"now"},"final":true}\n\n'));
          controller.close();
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body,
      } as unknown as Response);

      const collected: StreamEvent[] = [];
      for await (const event of client.sendStreamingMessage(mockSendRequest('test'))) {
        collected.push(event);
      }

      // Should yield 2 events, skipping the malformed one
      expect(collected).toHaveLength(2);
    });

    it('handles chunked SSE data split across reads', async () => {
      const encoder = new TextEncoder();
      const event1 = '{"id":"t1","status":{"state":"working","timestamp":"now"},"final":false}';
      const event2 = '{"id":"t1","status":{"state":"completed","timestamp":"now"},"final":true}';
      const fullPayload = `data: ${event1}\n\ndata: ${event2}\n\n`;

      // Split the payload mid-event to simulate chunked transfer
      const splitAt = Math.floor(fullPayload.length / 2);
      const chunk1 = fullPayload.slice(0, splitAt);
      const chunk2 = fullPayload.slice(splitAt);

      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(chunk1));
          controller.enqueue(encoder.encode(chunk2));
          controller.close();
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body,
      } as unknown as Response);

      const collected: StreamEvent[] = [];
      for await (const event of client.sendStreamingMessage(mockSendRequest('test'))) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
    });

    it('throws on HTTP error before streaming starts', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32602, message: 'Message must contain at least one text part' },
        })),
      } as Response);

      const gen = client.sendStreamingMessage(mockSendRequest(''));
      await expect(gen.next()).rejects.toThrow(A2AError);
    });
  });

  // ─── Task Management ───────────────────────────────────────

  describe('getTask', () => {
    it('fetches a task by ID', async () => {
      const task = mockTask();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: task }),
      } as Response);

      const result = await client.getTask('task-123');

      expect(result.id).toBe('task-123');
      expect(result.status.state).toBe('completed');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/tasks/task-123`);
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-jwt');
    });

    it('throws on task not found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Task not found' },
        })),
      } as Response);

      try {
        await client.getTask('nonexistent');
        expect.unreachable('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(A2AError);
        expect((e as A2AError).code).toBe(-32001);
      }
    });

    it('encodes task ID in URL', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: mockTask({ id: 'id with spaces' }) }),
      } as Response);

      await client.getTask('id with spaces');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/tasks/id%20with%20spaces`);
    });
  });

  describe('listTasks', () => {
    it('lists tasks with default options', async () => {
      const response: TaskListResponse = {
        tasks: [mockTask({ id: 't1' }), mockTask({ id: 't2' })],
        nextPageToken: 't2',
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: response }),
      } as Response);

      const result = await client.listTasks();

      expect(result.tasks).toHaveLength(2);
      expect(result.nextPageToken).toBe('t2');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/tasks`);
    });

    it('sends limit and pageToken as query params', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: { tasks: [], nextPageToken: undefined } }),
      } as Response);

      await client.listTasks({ limit: 5, pageToken: 'abc' });

      const call = vi.mocked(fetch).mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain('limit=5');
      expect(url).toContain('pageToken=abc');
    });

    it('sends contextId as query param for filtering', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: { tasks: [] } }),
      } as Response);

      await client.listTasks({ contextId: 'project-alpha' });

      const call = vi.mocked(fetch).mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain('contextId=project-alpha');
    });

    it('sends status as query param for filtering', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: { tasks: [] } }),
      } as Response);

      await client.listTasks({ status: 'completed' });

      const call = vi.mocked(fetch).mock.calls[0];
      const url = call[0] as string;
      expect(url).toContain('status=completed');
    });

    it('handles empty task list', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: { tasks: [] } }),
      } as Response);

      const result = await client.listTasks();
      expect(result.tasks).toHaveLength(0);
      expect(result.nextPageToken).toBeUndefined();
    });
  });

  describe('cancelTask', () => {
    it('cancels a task and returns canceled state', async () => {
      const canceledTask = mockTask({
        id: 'task-123',
        status: { state: 'canceled', timestamp: '2026-02-13T10:00:00Z' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: canceledTask }),
      } as Response);

      const result = await client.cancelTask('task-123');

      expect(result.status.state).toBe('canceled');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/tasks/task-123:cancel`);
      expect(call[1]?.method).toBe('POST');
    });

    it('throws on cancel of nonexistent task', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Task not found' },
        })),
      } as Response);

      await expect(client.cancelTask('ghost')).rejects.toThrow(A2AError);
    });
  });

  // ─── Task Subscription ──────────────────────────────────────

  describe('subscribeToTask', () => {
    it('subscribes to task updates via SSE', async () => {
      const events: StreamEvent[] = [
        {
          id: 'task-1',
          status: { state: 'working', timestamp: '2026-02-13T10:00:00Z' },
          final: false,
        },
        {
          id: 'task-1',
          status: {
            state: 'completed',
            message: { role: 'agent', parts: [{ type: 'text', text: 'Done!' }] },
            timestamp: '2026-02-13T10:00:01Z',
          },
          final: true,
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body: createSSEStream(events),
      } as unknown as Response);

      const collected: StreamEvent[] = [];
      for await (const event of client.subscribeToTask('task-1')) {
        collected.push(event);
      }

      expect(collected).toHaveLength(2);
      expect('status' in collected[0] && collected[0].status.state).toBe('working');
      expect('status' in collected[1] && collected[1].final).toBe(true);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/a2a/tasks/task-1:subscribe`);
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-jwt');
      expect(headers['A2A-Version']).toBe('0.3');
    });

    it('throws on subscribe to nonexistent task', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Task not found' },
        })),
      } as Response);

      const gen = client.subscribeToTask('ghost');
      await expect(gen.next()).rejects.toThrow(A2AError);
    });

    it('handles terminal task (single event then closes)', async () => {
      const terminalEvent: StreamEvent = {
        id: 'task-done',
        status: {
          state: 'completed',
          message: { role: 'agent', parts: [{ type: 'text', text: 'Already done' }] },
          timestamp: '2026-02-13T10:00:00Z',
        },
        final: true,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body: createSSEStream([terminalEvent]),
      } as unknown as Response);

      const collected: StreamEvent[] = [];
      for await (const event of client.subscribeToTask('task-done')) {
        collected.push(event);
      }

      expect(collected).toHaveLength(1);
      expect('status' in collected[0] && collected[0].status.state).toBe('completed');
    });
  });

  // ─── Task with contextId and cost ─────────────────────────

  describe('task metadata', () => {
    it('returns task with contextId field', async () => {
      const task = mockTask({ id: 't1', contextId: 'project-alpha' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: task }),
      } as Response);

      const result = await client.getTask('t1');
      expect(result.contextId).toBe('project-alpha');
    });

    it('returns task with cost metadata', async () => {
      const task = mockTask({
        id: 't1',
        metadata: {
          cost: { total: '1200', llm: '700', tools: '500', model: 'claude-haiku-4-5-20251001' },
        },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', result: task }),
      } as Response);

      const result = await client.getTask('t1');
      const cost = result.metadata?.cost as { total: string; llm: string; tools: string; model: string };
      expect(cost.total).toBe('1200');
      expect(cost.llm).toBe('700');
      expect(cost.tools).toBe('500');
      expect(cost.model).toBe('claude-haiku-4-5-20251001');
    });
  });

  // ─── Token Management ──────────────────────────────────────

  describe('setToken', () => {
    it('updates the auth token used in subsequent requests', async () => {
      const noAuthClient = new A2AClient({ baseUrl: BASE });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ jsonrpc: '2.0', result: { tasks: [] } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ jsonrpc: '2.0', result: { tasks: [] } }),
        } as Response);

      // First call without token
      await noAuthClient.listTasks();
      let headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();

      // Set token and call again
      noAuthClient.setToken('new-token');
      await noAuthClient.listTasks();
      headers = fetchSpy.mock.calls[1][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer new-token');
    });
  });

  // ─── URL Handling ──────────────────────────────────────────

  describe('constructor', () => {
    it('strips trailing slash from base URL', async () => {
      const slashClient = new A2AClient({ baseUrl: `${BASE}/` });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAgentCard()),
      } as Response);

      await slashClient.getAgentCard();

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/.well-known/agent.json`);
    });
  });

  // ─── A2AError ──────────────────────────────────────────────

  describe('A2AError', () => {
    it('captures code, message, and data from JSON-RPC error', () => {
      const error = new A2AError({
        code: -32001,
        message: 'Task not found',
        data: { taskId: 'abc' },
      });

      expect(error.name).toBe('A2AError');
      expect(error.code).toBe(-32001);
      expect(error.message).toBe('Task not found');
      expect(error.data).toEqual({ taskId: 'abc' });
      expect(error).toBeInstanceOf(Error);
    });
  });
});
