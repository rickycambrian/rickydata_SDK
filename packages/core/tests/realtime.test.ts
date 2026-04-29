import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseSSEChunk,
  streamSSEJson,
  streamSSEJsonFromResponse,
  createRealtimeConnectionState,
  type RealtimeConnectionStateSnapshot,
} from '../src/realtime/index.js';

function responseFromChunks(chunks: string[], delayMs = 0): Response {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of chunks) {
          if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  } as unknown as Response;
}

function neverClosingResponse(initialChunks: string[] = []): Response {
  const encoder = new TextEncoder();
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of initialChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      },
    }),
  } as unknown as Response;
}

describe('realtime SSE helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses id, event, retry, comments, and multi-line data', () => {
    const parsed = parseSSEChunk([
      ': heartbeat',
      'id: evt-1',
      'event: progress',
      'retry: 2500',
      'data: {"a":1}',
      'data: {"b":2}',
    ].join('\n'));

    expect(parsed).toEqual({
      id: 'evt-1',
      event: 'progress',
      retry: 2500,
      data: '{"a":1}\n{"b":2}',
      comments: ['heartbeat'],
    });
  });

  it('yields JSON events from split chunks and skips malformed JSON', async () => {
    const response = responseFromChunks([
      'id: 1\nevent: text\ndata: {"type":"text","data":"hel',
      'lo"}\n\n',
      'data: {not-json}\n\n',
      'id: 2\nevent: done\ndata: {"type":"done","data":{}}\n\n',
      'data: [DONE]\n\n',
    ]);

    const events = [];
    for await (const event of streamSSEJsonFromResponse<{ type: string; data: unknown }>(response)) {
      events.push(event);
    }

    expect(events).toEqual([
      { id: '1', event: 'text', data: { type: 'text', data: 'hello' }, raw: '{"type":"text","data":"hello"}' },
      { id: '2', event: 'done', data: { type: 'done', data: {} }, raw: '{"type":"done","data":{}}' },
    ]);
  });

  it('sets Last-Event-ID and retries a failed connection with backoff', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(responseFromChunks([
        'id: 3\ndata: {"ok":true}\n\n',
        'data: [DONE]\n\n',
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const states: RealtimeConnectionStateSnapshot[] = [];
    const events = [];
    for await (const event of streamSSEJson<{ ok: boolean }>('https://example.com/stream', {
      lastEventId: '2',
      retry: { initialMs: 1, maxMs: 1, maxRetries: 1, jitter: false },
      onConnectionState: state => states.push(state),
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = new Headers(fetchMock.mock.calls[1][1].headers as HeadersInit);
    expect(headers.get('last-event-id')).toBe('2');
    expect(states.map(s => s.status)).toContain('reconnecting');
    expect(states.at(-1)?.status).toBe('closed');
  });

  it('aborts a stream when heartbeat timeout expires', async () => {
    await expect(async () => {
      for await (const _event of streamSSEJsonFromResponse(neverClosingResponse(), { heartbeatTimeoutMs: 20 })) {
        // consume
      }
    }).rejects.toThrow(/idle for 20ms/);
  }, 2000);

  it('tracks realtime connection state snapshots', () => {
    const state = createRealtimeConnectionState();
    state.setConnecting();
    state.setConnected('evt-1');
    state.setReconnecting(2, new Error('network'));
    state.setClosed();

    expect(state.getSnapshot()).toMatchObject({
      status: 'closed',
      reconnectAttempts: 2,
      lastEventId: 'evt-1',
    });
  });
});
