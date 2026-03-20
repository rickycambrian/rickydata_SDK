import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentClient } from '../src/agent/agent-client.js';
import type { ImageAttachment } from '../src/agent/types.js';

const GATEWAY = 'https://agents.rickydata.org';
const TOKEN = 'pre-existing-token';

// ─── Helpers ────────────────────────────────────────────────

function makeOkResponse(body?: ReadableStream<Uint8Array>): Response {
  return {
    ok: true,
    body: body ?? null,
  } as unknown as Response;
}

function emptySSEStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"done","data":{}}\n\n'));
      controller.close();
    },
  });
}

function captureLastChatBody(fetchSpy: ReturnType<typeof vi.spyOn>): unknown {
  const calls = fetchSpy.mock.calls;
  // The last call is the chat POST
  const lastCall = calls[calls.length - 1];
  const init = lastCall[1] as RequestInit;
  return JSON.parse(init.body as string);
}

// ─── Tests ──────────────────────────────────────────────────

describe('AgentClient.chatRaw — image attachment support', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends no images key when images parameter is omitted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Session creation
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'sess-1' }),
    } as Response);
    // Chat response
    fetchSpy.mockResolvedValueOnce(makeOkResponse(emptySSEStream()));

    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    await client.chatRaw('test-agent', 'sess-1', 'hello');

    const body = captureLastChatBody(fetchSpy);
    expect(body).not.toHaveProperty('images');
  });

  it('sends no images key when images is an empty array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce(makeOkResponse(emptySSEStream()));

    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    await client.chatRaw('test-agent', 'sess-1', 'hello', undefined, []);

    const body = captureLastChatBody(fetchSpy);
    expect(body).not.toHaveProperty('images');
  });

  it('includes images in the request body when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce(makeOkResponse(emptySSEStream()));

    const images: ImageAttachment[] = [
      { data: 'base64encodeddata==', mediaType: 'image/jpeg' },
    ];

    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    await client.chatRaw('test-agent', 'sess-1', 'describe this screenshot', undefined, images);

    const body = captureLastChatBody(fetchSpy) as Record<string, unknown>;
    expect(body).toHaveProperty('images');
    expect(body.images).toEqual(images);
  });

  it('includes multiple images in the request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce(makeOkResponse(emptySSEStream()));

    const images: ImageAttachment[] = [
      { data: 'first==', mediaType: 'image/png' },
      { data: 'second==', mediaType: 'image/webp' },
      { data: 'third==', mediaType: 'image/jpeg' },
    ];

    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    await client.chatRaw('test-agent', 'sess-1', 'compare these frames', undefined, images);

    const body = captureLastChatBody(fetchSpy) as Record<string, unknown>;
    expect(body.images).toHaveLength(3);
    expect(body.images).toEqual(images);
  });

  it('preserves message and model alongside images', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce(makeOkResponse(emptySSEStream()));

    const images: ImageAttachment[] = [
      { data: 'imgdata==', mediaType: 'image/png' },
    ];

    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    await client.chatRaw('test-agent', 'sess-1', 'what is on screen?', 'sonnet', images);

    const body = captureLastChatBody(fetchSpy) as Record<string, unknown>;
    expect(body.message).toBe('what is on screen?');
    expect(body.model).toBe('sonnet');
    expect(body.images).toEqual(images);
  });

  it('posts to the correct chat endpoint URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce(makeOkResponse(emptySSEStream()));

    const images: ImageAttachment[] = [{ data: 'data==', mediaType: 'image/jpeg' }];
    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    await client.chatRaw('my-agent', 'my-session', 'hello', undefined, images);

    const [url] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    expect(url).toBe(`${GATEWAY}/agents/my-agent/sessions/my-session/chat`);
  });

  it('returns the raw Response for SSE streaming', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const stream = emptySSEStream();
    fetchSpy.mockResolvedValueOnce(makeOkResponse(stream));

    const images: ImageAttachment[] = [{ data: 'data==', mediaType: 'image/webp' }];
    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });
    const res = await client.chatRaw('test-agent', 'sess-1', 'hi', undefined, images);

    expect(res).toBeDefined();
    expect(res.ok).toBe(true);
  });

  it('throws AgentError on non-ok response even with images', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: () => Promise.resolve({ error: 'Payment required' }),
    } as Response);

    const images: ImageAttachment[] = [{ data: 'data==', mediaType: 'image/jpeg' }];
    const client = new AgentClient({ token: TOKEN, sessionStorePath: null });

    await expect(
      client.chatRaw('test-agent', 'sess-1', 'hi', undefined, images),
    ).rejects.toThrow('Payment required');
  });
});

// ─── ImageAttachment type shape ──────────────────────────────

describe('ImageAttachment type', () => {
  it('accepts all supported media types', () => {
    // These compile-time checks are validated by TypeScript; at runtime we
    // just verify the objects are formed correctly.
    const jpeg: ImageAttachment = { data: 'abc', mediaType: 'image/jpeg' };
    const png: ImageAttachment = { data: 'abc', mediaType: 'image/png' };
    const webp: ImageAttachment = { data: 'abc', mediaType: 'image/webp' };

    expect(jpeg.mediaType).toBe('image/jpeg');
    expect(png.mediaType).toBe('image/png');
    expect(webp.mediaType).toBe('image/webp');
  });

  it('contains only data and mediaType fields', () => {
    const img: ImageAttachment = { data: 'base64data==', mediaType: 'image/png' };
    const keys = Object.keys(img);
    expect(keys).toEqual(expect.arrayContaining(['data', 'mediaType']));
    expect(keys).toHaveLength(2);
  });
});
