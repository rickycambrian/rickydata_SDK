import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentClient } from '../src/agent/agent-client.js';
import type { SSEEvent } from '../src/agent/types.js';

const GATEWAY = 'https://agents.rickydata.org';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // hardhat #0

// ─── Helpers ────────────────────────────────────────────────

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

function mockAuthFlow() {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  // Challenge
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ nonce: 'nonce-123', message: 'Sign this message' }),
  } as Response);
  // Verify
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ token: 'jwt-token-123', walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }),
  } as Response);
  return fetchSpy;
}

// ─── Tests ──────────────────────────────────────────────────

describe('AgentClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constructor ────────────────────────────────────────

  describe('constructor', () => {
    it('requires a private key or token', () => {
      expect(() => new AgentClient({ privateKey: '' })).toThrow('Either privateKey or token is required');
    });

    it('accepts a pre-existing token without privateKey', () => {
      const client = new AgentClient({ token: 'jwt-token-123' });
      expect(client).toBeDefined();
    });

    it('accepts a hex private key with 0x prefix', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      expect(client).toBeDefined();
    });

    it('auto-prefixes 0x to private key', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY.slice(2) });
      expect(client).toBeDefined();
    });

    it('uses default gateway URL', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      expect(client).toBeDefined();
    });

    it('accepts a custom gateway URL', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, gatewayUrl: 'https://custom.example.com/' });
      expect(client).toBeDefined();
    });
  });

  // ─── Authentication ─────────────────────────────────────

  describe('authentication', () => {
    it('authenticates on first chat via challenge/verify', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Auth: challenge + verify
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: 'nonce-1', message: 'Sign this' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-abc' }),
        } as Response)
        // Create session
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'sess-1' }),
        } as Response)
        // Chat response (empty stream)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'done', data: {} },
          ]),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await client.chat('test-agent', 'hello');

      // Should have called challenge + verify
      expect(fetchSpy).toHaveBeenCalledWith(`${GATEWAY}/auth/challenge`);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/auth/verify`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws on auth challenge failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', 'hello')).rejects.toThrow('Auth challenge failed: 500');
    });

    it('throws on auth verify failure', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve('Invalid signature'),
        } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', 'hello')).rejects.toThrow('Auth verification failed: 403');
    });
  });

  // ─── Chat ───────────────────────────────────────────────

  describe('chat', () => {
    it('validates agentId is not empty', async () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('', 'hello')).rejects.toThrow('agentId is required');
    });

    it('validates message is not empty', async () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', '')).rejects.toThrow('message is required');
    });

    it('parses text events and accumulates response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Auth
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        // Session
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        // Chat SSE
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'text', data: 'Hello ' },
            { type: 'text', data: 'world!' },
            { type: 'done', data: { cost: '$0.001', toolCallCount: 0, usage: { inputTokens: 10, outputTokens: 5 } } },
          ]),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.chat('test-agent', 'hi');

      expect(result.text).toBe('Hello world!');
      expect(result.sessionId).toBe('sess-1');
      expect(result.cost).toBe('$0.001');
      expect(result.toolCallCount).toBe(0);
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('fires onText callback for each text chunk', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'text', data: 'chunk1' },
            { type: 'text', data: 'chunk2' },
            { type: 'done', data: {} },
          ]),
        } as unknown as Response);

      const chunks: string[] = [];
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await client.chat('test-agent', 'hi', {
        onText: (t) => chunks.push(t),
      });

      expect(chunks).toEqual(['chunk1', 'chunk2']);
    });

    it('fires onToolCall and onToolResult callbacks', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'tool_call', data: { name: 'brave_search', displayName: 'Brave Search', args: { query: 'test' } } },
            { type: 'tool_result', data: { name: 'brave_search', isError: false, result: 'search results' } },
            { type: 'text', data: 'Based on the search...' },
            { type: 'done', data: { toolCallCount: 1 } },
          ]),
        } as unknown as Response);

      const toolCalls: Array<{ name: string; displayName?: string }> = [];
      const toolResults: Array<{ name: string; isError: boolean }> = [];

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.chat('test-agent', 'search for test', {
        onToolCall: (t) => toolCalls.push({ name: t.name, displayName: t.displayName }),
        onToolResult: (r) => toolResults.push({ name: r.name, isError: r.isError }),
      });

      expect(toolCalls).toEqual([{ name: 'brave_search', displayName: 'Brave Search' }]);
      expect(toolResults).toEqual([{ name: 'brave_search', isError: false }]);
      expect(result.toolCallCount).toBe(1);
    });

    it('throws on error SSE event', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'error', data: { message: 'Insufficient balance' } },
          ]),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', 'hi')).rejects.toThrow('Agent error: Insufficient balance');
    });

    it('throws on HTTP error from chat endpoint', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 402,
          text: () => Promise.resolve('Payment required'),
        } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', 'hi')).rejects.toThrow('Chat failed: 402');
    });

    it('wraps terminated transport errors with session recovery guidance', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockRejectedValueOnce(new Error('terminated'));

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', 'hi')).rejects.toThrow(
        'Connection interrupted while streaming response (sessionId: sess-1)'
      );
      expect(client.getCachedSessionId('test-agent')).toBe('sess-1');
    });

    it('wraps terminated stream read errors with session recovery guidance', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.error(new Error('terminated'));
            },
          }),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.chat('test-agent', 'hi')).rejects.toThrow(
        'Connection interrupted while streaming response (sessionId: sess-1)'
      );
    });
  });

  // ─── Session Reuse ──────────────────────────────────────

  describe('session reuse', () => {
    it('reuses session for same agent on subsequent chats', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // First chat: auth + session + chat
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([{ type: 'text', data: 'first' }, { type: 'done', data: {} }]),
        } as unknown as Response)
        // Second chat: only chat (no auth, no session creation)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([{ type: 'text', data: 'second' }, { type: 'done', data: {} }]),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const r1 = await client.chat('test-agent', 'first message');
      const r2 = await client.chat('test-agent', 'second message');

      expect(r1.sessionId).toBe('sess-1');
      expect(r2.sessionId).toBe('sess-1');
      // Should only have 5 fetch calls (auth 2 + session 1 + chat 2), not 7
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    });

    it('allows explicit sessionId override', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        // No session creation call — using explicit sessionId
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([{ type: 'text', data: 'hi' }, { type: 'done', data: {} }]),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.chat('test-agent', 'hello', { sessionId: 'my-session' });

      expect(result.sessionId).toBe('my-session');
      // Only 3 calls: auth challenge + verify + chat (no session creation)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  // ─── List Agents ────────────────────────────────────────

  describe('listAgents', () => {
    it('returns list of agents without authentication', async () => {
      const agents = [
        { id: 'research-agent', name: 'research-agent', title: 'Research Agent', description: 'Web research', model: 'haiku', skillsCount: 3 },
        { id: 'code-assistant', name: 'code-assistant', title: 'Code Assistant', description: 'Code help', model: 'sonnet', skillsCount: 2 },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ agents }),
      } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.listAgents();

      expect(result).toEqual(agents);
      expect(fetch).toHaveBeenCalledWith(`${GATEWAY}/agents`);
    });

    it('throws on list agents failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.listAgents()).rejects.toThrow('Failed to list agents: 500');
    });
  });

  // ─── API Key Management ─────────────────────────────────

  describe('configureApiKey', () => {
    it('rejects invalid API key format', async () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await expect(client.configureApiKey('invalid-key')).rejects.toThrow('must start with "sk-ant-"');
    });

    it('stores API key via PUT /wallet/apikey', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Auth
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        // Store API key
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, configured: true }) } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await client.configureApiKey('sk-ant-test-key');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/wallet/apikey`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ anthropicApiKey: 'sk-ant-test-key' }),
        }),
      );
    });
  });

  describe('isApiKeyConfigured', () => {
    it('returns true when key is configured', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ configured: true }) } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.isApiKeyConfigured();
      expect(result).toBe(true);
    });

    it('returns false when key is not configured', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ configured: false }) } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.isApiKeyConfigured();
      expect(result).toBe(false);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty response body gracefully', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: null,
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.chat('test-agent', 'hi');

      expect(result.text).toBe('');
      expect(result.sessionId).toBe('sess-1');
    });

    it('skips malformed SSE data lines', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const encoder = new TextEncoder();

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('data: not-valid-json\n\n'));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', data: 'valid' })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', data: {} })}\n\n`));
              controller.close();
            },
          }),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.chat('test-agent', 'hi');

      expect(result.text).toBe('valid');
    });

    it('handles tool_result with content field instead of result', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'tool_result', data: { name: 'test', isError: false, content: 'content-field' } } as SSEEvent,
            { type: 'done', data: {} },
          ]),
        } as unknown as Response);

      const results: Array<{ result?: string }> = [];
      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      await client.chat('test-agent', 'hi', {
        onToolResult: (r) => results.push({ result: r.result }),
      });

      expect(results[0].result).toBe('content-field');
    });
  });

  describe('builder controls', () => {
    it('toggles KnowledgeBook tools via /agents/custom/:id/kb-tools', async () => {
      const fetchSpy = mockAuthFlow();

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ kbToolsEnabled: true }),
      } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.setKnowledgeBookTools('my-agent', true);

      expect(result.kbToolsEnabled).toBe(true);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        3,
        `${GATEWAY}/agents/custom/my-agent/kb-tools`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer jwt-token-123' }),
          body: JSON.stringify({ enabled: true }),
        }),
      );
    });

    it('updates reflect config via /agents/custom/:id/reflect', async () => {
      const fetchSpy = mockAuthFlow();

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reflectEnabled: true, reflectConfig: { minConfidence: 0.6, autoShare: false, defaultSpace: 'general' } }),
      } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY });
      const result = await client.updateReflectConfig('my-agent', { enabled: true });

      expect(result.reflectEnabled).toBe(true);
      expect(fetchSpy).toHaveBeenNthCalledWith(
        3,
        `${GATEWAY}/agents/custom/my-agent/reflect`,
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer jwt-token-123' }),
        }),
      );
    });
  });
});
