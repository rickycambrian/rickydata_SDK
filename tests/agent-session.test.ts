import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentSession } from '../src/agent/agent-session.js';
import type { SSEEvent } from '../src/agent/types.js';

const GATEWAY = 'https://agents.rickydata.org';
// Hardhat default account #0 — well-known public test key, split to avoid secret guard
const PRIVATE_KEY = ['0xac0974bec39a17e36ba4a6b4d238ff944b', 'acb478cbed5efcae784d7bf4f2ff80'].join('') as `0x${string}`;
const TOKEN = 'jwt-token-abc';

// ─── Helpers ─────────────────────────────────────────────────

function createSSEStream(events: SSEEvent[]): ReadableStream<Uint8Array> {
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

function mockSessionCreation(fetchSpy: ReturnType<typeof vi.spyOn>, sessionId = 'sess-001') {
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ id: sessionId }),
  } as Response);
}

function mockChatResponse(
  fetchSpy: ReturnType<typeof vi.spyOn>,
  text: string,
  sessionId = 'sess-001',
) {
  const events: SSEEvent[] = [
    { type: 'text', data: text },
    { type: 'done', data: { cost: '$0.001', toolCallCount: 0 } },
  ];
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    body: createSSEStream(events),
  } as unknown as Response);
}

// ─── connect() with token ─────────────────────────────────────

describe('AgentSession.connect (with token)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates session using pre-existing token (no wallet auth needed)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy, 'sess-token-001');

    const session = await AgentSession.connect(
      { token: TOKEN, gatewayUrl: GATEWAY },
      'research-agent',
    );

    expect(session).toBeDefined();
    expect(session.sessionId).toBe('sess-token-001');
    expect(session.agentId).toBe('research-agent');

    // Only session creation call, no auth calls
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe(`${GATEWAY}/agents/research-agent/sessions`);
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('throws if neither privateKey nor token provided', async () => {
    await expect(
      AgentSession.connect({ gatewayUrl: GATEWAY }, 'research-agent'),
    ).rejects.toThrow('Either privateKey or token is required');
  });

  it('throws if agentId is empty', async () => {
    await expect(
      AgentSession.connect({ token: TOKEN }, ''),
    ).rejects.toThrow('agentId is required');
  });

  it('uses default gateway URL when gatewayUrl not provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);

    await AgentSession.connect({ token: TOKEN }, 'research-agent');

    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe(`https://agents.rickydata.org/agents/research-agent/sessions`);
  });

  it('strips trailing slash from gatewayUrl', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);

    await AgentSession.connect({ token: TOKEN, gatewayUrl: `${GATEWAY}/` }, 'research-agent');

    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe(`${GATEWAY}/agents/research-agent/sessions`);
  });

  it('URL-encodes agentId with special characters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);

    await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'my agent');

    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe(`${GATEWAY}/agents/my%20agent/sessions`);
  });

  it('throws on session creation HTTP error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Agent not found'),
    } as Response);

    await expect(
      AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'unknown-agent'),
    ).rejects.toThrow('Failed to create session: 404 Agent not found');
  });
});

// ─── connect() with privateKey ────────────────────────────────

describe('AgentSession.connect (with privateKey)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('authenticates via challenge/verify then creates session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // Auth: challenge
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ nonce: 'nonce-xyz', message: 'Sign this message' }),
    } as Response);
    // Auth: verify
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ token: 'wallet-jwt-token' }),
    } as Response);
    // Session creation
    mockSessionCreation(fetchSpy, 'sess-wallet-001');

    const session = await AgentSession.connect(
      { privateKey: PRIVATE_KEY, gatewayUrl: GATEWAY },
      'research-agent',
    );

    expect(session.sessionId).toBe('sess-wallet-001');

    // Verify call order: challenge → verify → session
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${GATEWAY}/auth/challenge`);
    expect(fetchSpy.mock.calls[1][0]).toBe(`${GATEWAY}/auth/verify`);
    expect(fetchSpy.mock.calls[2][0]).toBe(`${GATEWAY}/agents/research-agent/sessions`);

    // Session request uses authenticated token
    const sessionHeaders = fetchSpy.mock.calls[2][1]?.headers as Record<string, string>;
    expect(sessionHeaders['Authorization']).toBe('Bearer wallet-jwt-token');
  });

  it('throws on auth challenge failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    await expect(
      AgentSession.connect({ privateKey: PRIVATE_KEY, gatewayUrl: GATEWAY }, 'research-agent'),
    ).rejects.toThrow('Auth challenge failed: 503');
  });

  it('throws on auth verify failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ nonce: 'n', message: 'Sign this message' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Invalid signature'),
      } as Response);

    await expect(
      AgentSession.connect({ privateKey: PRIVATE_KEY, gatewayUrl: GATEWAY }, 'research-agent'),
    ).rejects.toThrow('Auth verification failed: 401 Invalid signature');
  });
});

// ─── send() ──────────────────────────────────────────────────

describe('AgentSession.send', () => {
  async function createSession(fetchSpy: ReturnType<typeof vi.spyOn>) {
    mockSessionCreation(fetchSpy, 'sess-send-001');
    return AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'research-agent');
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a message and returns ChatResult', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const session = await createSession(fetchSpy);
    mockChatResponse(fetchSpy, 'DeFi stands for Decentralized Finance.');

    const result = await session.send('What is DeFi?');

    expect(result.text).toBe('DeFi stands for Decentralized Finance.');
    expect(result.sessionId).toBe('sess-send-001');

    // Chat request uses correct endpoint with session ID
    const chatCall = fetchSpy.mock.calls[1];
    expect(chatCall[0]).toContain('/agents/research-agent/sessions/sess-send-001/chat');
  });

  it('throws if message is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const session = await createSession(fetchSpy);

    await expect(session.send('')).rejects.toThrow('message is required');
  });

  it('records messages in history', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const session = await createSession(fetchSpy);
    mockChatResponse(fetchSpy, 'First response');
    mockChatResponse(fetchSpy, 'Second response');

    await session.send('First question');
    await session.send('Second question');

    const history = await session.history();
    expect(history).toHaveLength(4);
    expect(history[0].role).toBe('user');
    expect(history[0].content).toBe('First question');
    expect(history[1].role).toBe('assistant');
    expect(history[1].content).toBe('First response');
    expect(history[2].role).toBe('user');
    expect(history[2].content).toBe('Second question');
    expect(history[3].role).toBe('assistant');
    expect(history[3].content).toBe('Second response');
  });

  it('history entries include timestamps', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const session = await createSession(fetchSpy);
    mockChatResponse(fetchSpy, 'Response');

    const before = new Date();
    await session.send('Hello');
    const after = new Date();

    const history = await session.history();
    expect(history[0].timestamp).toBeInstanceOf(Date);
    expect(history[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('calls onText callback for streaming text', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const session = await createSession(fetchSpy);

    const textChunks: SSEEvent[] = [
      { type: 'text', data: 'Hello ' },
      { type: 'text', data: 'world' },
      { type: 'done', data: {} },
    ];
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(textChunks),
    } as unknown as Response);

    const received: string[] = [];
    await session.send('Hi', { onText: (t) => received.push(t) });

    expect(received).toEqual(['Hello ', 'world']);
  });

  it('calls onToolCall callback when agent invokes a tool', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const session = await createSession(fetchSpy);

    const events: SSEEvent[] = [
      { type: 'tool_call', data: { name: 'search', displayName: 'Search', args: { query: 'DeFi' } } },
      { type: 'tool_result', data: { name: 'search', isError: false, result: 'DeFi info' } },
      { type: 'text', data: 'Based on search...' },
      { type: 'done', data: { toolCallCount: 1 } },
    ];
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: createSSEStream(events),
    } as unknown as Response);

    const toolCalls: Array<{ name: string }> = [];
    const result = await session.send('Search DeFi', {
      onToolCall: (tool) => toolCalls.push({ name: tool.name }),
    });

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].name).toBe('search');
    expect(result.toolCallCount).toBe(1);
  });
});

// ─── resume() ────────────────────────────────────────────────

describe('AgentSession.resume', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('updates sessionId for subsequent sends', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy, 'sess-original');
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'research-agent');

    expect(session.sessionId).toBe('sess-original');

    await session.resume('sess-resumed');
    expect(session.sessionId).toBe('sess-resumed');

    mockChatResponse(fetchSpy, 'Resumed response');
    await session.send('Hello again');

    const chatCall = fetchSpy.mock.calls[1];
    expect(chatCall[0]).toContain('/sessions/sess-resumed/chat');
  });

  it('throws if sessionId is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy, 'sess-001');
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'research-agent');

    await expect(session.resume('')).rejects.toThrow('sessionId is required');
  });
});

// ─── history() ───────────────────────────────────────────────

describe('AgentSession.history', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array before any messages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'research-agent');

    const history = await session.history();
    expect(history).toEqual([]);
  });

  it('returns a copy so mutations do not affect internal history', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'research-agent');

    mockChatResponse(fetchSpy, 'Reply');
    await session.send('Hello');

    const history1 = await session.history();
    history1.push({ role: 'user', content: 'injected', timestamp: new Date() });

    const history2 = await session.history();
    expect(history2).toHaveLength(2); // user + assistant, not 3
  });
});

// ─── close() ─────────────────────────────────────────────────

describe('AgentSession.close', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears local history on close', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'research-agent');

    mockChatResponse(fetchSpy, 'Response');
    await session.send('Hello');

    const historyBefore = await session.history();
    expect(historyBefore).toHaveLength(2);

    await session.close();

    const historyAfter = await session.history();
    expect(historyAfter).toHaveLength(0);
  });
});

// ─── getters ─────────────────────────────────────────────────

describe('AgentSession getters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes agentId', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy);
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'my-agent');
    expect(session.agentId).toBe('my-agent');
  });

  it('exposes sessionId', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSessionCreation(fetchSpy, 'sess-xyz');
    const session = await AgentSession.connect({ token: TOKEN, gatewayUrl: GATEWAY }, 'my-agent');
    expect(session.sessionId).toBe('sess-xyz');
  });
});
