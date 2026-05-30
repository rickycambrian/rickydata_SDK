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

function createNDJSONStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map(e => `${JSON.stringify(e)}\n`);
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
      expect(() => new AgentClient({ privateKey: '' })).toThrow('Either privateKey, token, or tokenGetter is required');
    });

    it('accepts a pre-existing token without privateKey', () => {
      const client = new AgentClient({ token: 'jwt-token-123', sessionStorePath: null });
      expect(client).toBeDefined();
    });

    it('accepts a hex private key with 0x prefix', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      expect(client).toBeDefined();
    });

    it('auto-prefixes 0x to private key', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY.slice(2), sessionStorePath: null });
      expect(client).toBeDefined();
    });

    it('uses default gateway URL', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      expect(client).toBeDefined();
    });

    it('accepts a custom gateway URL', () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, gatewayUrl: 'https://custom.example.com/', sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.chat('test-agent', 'hello')).rejects.toThrow('Auth verification failed: 403');
    });

    it('forces token refresh once when a raw chat request gets a pre-stream 401', async () => {
      const tokenGetter = vi.fn()
        .mockResolvedValueOnce('expired-token')
        .mockResolvedValueOnce('fresh-token');
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('expired'),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([{ type: 'done', data: {} }]),
        } as unknown as Response);

      const client = new AgentClient({ tokenGetter, sessionStorePath: null });
      const res = await client.chatRaw('test-agent', 'sess-1', 'hello');

      expect(res.ok).toBe(true);
      expect(tokenGetter).toHaveBeenCalledWith(undefined);
      expect(tokenGetter).toHaveBeenCalledWith({ forceRefresh: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const retryHeaders = new Headers((fetchSpy.mock.calls[1][1] as RequestInit).headers as HeadersInit);
      expect(retryHeaders.get('authorization')).toBe('Bearer fresh-token');
    });
  });

  // ─── Chat ───────────────────────────────────────────────

  describe('chat', () => {
    it('validates agentId is not empty', async () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.chat('', 'hello')).rejects.toThrow('agentId is required');
    });

    it('validates message is not empty', async () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const result = await client.chat('test-agent', 'hi');

      expect(result.text).toBe('Hello world!');
      expect(result.sessionId).toBe('sess-1');
      expect(result.cost).toBe('$0.001');
      expect(result.toolCallCount).toBe(0);
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    });

    it('returns model and execution engine metadata from done events', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'sess-1', agentId: 'test-agent', model: 'glm-5.1', executionEngine: 'openclaude' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            {
              type: 'done',
              data: {
                model: 'glm-5.1',
                executionEngine: 'openclaude',
                engineUsed: 'openclaude',
                cost: '$0.002',
                toolCallCount: 0,
                usage: { inputTokens: 12, outputTokens: 7 },
              },
            },
          ]),
        } as unknown as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const result = await client.chat('test-agent', 'hi');

      expect(result.model).toBe('glm-5.1');
      expect(result.executionEngine).toBe('openclaude');
      expect(result.engineUsed).toBe('openclaude');
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
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.chat('test-agent', 'hi')).rejects.toThrow('Insufficient balance');
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.chat('test-agent', 'hi')).rejects.toThrow('Payment required');
    });

    it('unlocks a sign-to-derive provider key and retries the original chat once', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        // First chat fails with locked provider key
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve(JSON.stringify({
            error: 'missing_secrets',
            needsUnlock: true,
            message: 'Your DeepSeek API key is encrypted and locked.',
            missingSecrets: [{ serverId: 'deepseek', secretKeys: ['DEEPSEEK_API_KEY'] }],
          })),
        } as Response)
        // Provider-vault challenge
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: 'derive-nonce', message: 'Sign provider vault' }),
        } as Response)
        // Provider-vault unlock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            unlocked: true,
            unlockedProviders: ['deepseek'],
            migratedProviders: [],
            lockedProviders: [],
            skippedProviders: [],
          }),
        } as Response)
        // Retried chat succeeds
        .mockResolvedValueOnce({
          ok: true,
          body: createSSEStream([
            { type: 'text', data: 'unlocked reply' },
            { type: 'done', data: {} },
          ]),
        } as unknown as Response);

      const signMessage = vi.fn().mockResolvedValue('0xsigned');
      const client = new AgentClient({ token: 'jwt', signMessage, sessionStorePath: null });
      const result = await client.chat('test-agent', 'hi', { sessionId: 'sess-1', model: 'deepseek-v4-pro' });

      expect(result.text).toBe('unlocked reply');
      expect(signMessage).toHaveBeenCalledWith('Sign provider vault');
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/wallet/provider-vault/unlock`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ signature: '0xsigned', nonce: 'derive-nonce', providers: ['deepseek'] }),
        }),
      );
    });

    it('wraps terminated transport errors with session recovery guidance', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'sess-1' }) } as Response)
        .mockRejectedValueOnce(new Error('terminated'));

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.chat('test-agent', 'hi', { maxRetries: 0 })).rejects.toThrow(
        'Connection interrupted while streaming response'
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.chat('test-agent', 'hi', { maxRetries: 0 })).rejects.toThrow(
        'Connection interrupted while streaming response'
      );
    });
  });

  describe('model guide specialist', () => {
    it('posts forced privacy flags and parses the final proof result', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        body: createNDJSONStream([
          { type: 'started', message: 'started' },
          {
            type: 'complete',
            result: {
              text: 'Use GPT-5.5 Codex for this repo.',
              price_usd: 0.8,
              tee_proof: { available: false, manifestHash: 'sha256:test' },
            },
          },
        ]),
      } as unknown as Response);

      const events: unknown[] = [];
      const client = new AgentClient({ token: 'jwt-token-123', sessionStorePath: null });
      const result = await client.runModelGuideSpecialist({
        model: 'codex-5.5',
        prompt: 'Which model should I use?',
        files: [{ content: 'print("hi")', mimeType: 'text/plain' }],
        skippedCount: 2,
      }, {
        onEvent: (event) => events.push(event),
      });

      expect(result.text).toContain('GPT-5.5');
      expect(result.tee_proof?.manifestHash).toBe('sha256:test');
      expect(events).toHaveLength(2);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/api/model-guide/analyze/stream`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer jwt-token-123' }),
        }),
      );
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.safety_flags).toEqual({
        persistConversations: false,
        recordConversationTrace: false,
        disableClaudeCodeHooks: true,
        disableCodexHooks: true,
        retainUploadedFiles: false,
        returnTeeDeletionProof: true,
      });
      expect(body.privacy).toEqual(expect.objectContaining({
        persist: false,
        trace: false,
        hooks: false,
        write_scope: 'none',
      }));
      expect(body.files[0]).not.toHaveProperty('relativePath');
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const result = await client.chat('test-agent', 'hello', { sessionId: 'my-session' });

      expect(result.sessionId).toBe('my-session');
      // Only 3 calls: auth challenge + verify + chat (no session creation)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('createSession', () => {
    it('returns execution engine metadata when the gateway includes it', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'sess-2',
            agentId: 'test-agent',
            model: 'glm-5.1',
            createdAt: '2026-04-14T00:00:00.000Z',
            executionEngine: 'openclaude',
          }),
        } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const session = await client.createSession('test-agent', 'glm-5.1');

      expect(session.executionEngine).toBe('openclaude');
    });

    it('passes through Gemini CLI execution engine requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'sess-gemini',
            agentId: 'test-agent',
            model: 'gemini-3-flash-preview',
            createdAt: '2026-04-27T00:00:00.000Z',
            executionEngine: 'gemini',
          }),
        } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const session = await client.createSession('test-agent', 'gemini-3-flash-preview', 'gemini');

      expect(session.executionEngine).toBe('gemini');
      expect(JSON.parse(fetchSpy.mock.calls[2][1]!.body as string)).toEqual({
        model: 'gemini-3-flash-preview',
        executionEngine: 'gemini',
      });
    });

    it('passes through Kimi Code execution engine requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'sess-kimi',
            agentId: 'test-agent',
            model: 'kimi-for-coding',
            createdAt: '2026-05-04T00:00:00.000Z',
            executionEngine: 'kimi-code',
          }),
        } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const session = await client.createSession('test-agent', 'kimi-for-coding', 'kimi-code');

      expect(session.executionEngine).toBe('kimi-code');
      expect(JSON.parse(fetchSpy.mock.calls[2][1]!.body as string)).toEqual({
        model: 'kimi-for-coding',
        executionEngine: 'kimi-code',
      });
    });

    it('passes through RickyData Code execution engine requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'sess-rickydata-code',
            agentId: 'test-agent',
            model: 'claude-haiku-4-5-20251001',
            createdAt: '2026-05-08T00:00:00.000Z',
            executionEngine: 'rickydata-code',
          }),
        } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const session = await client.createSession('test-agent', 'claude-haiku-4-5-20251001', 'rickydata-code');

      expect(session.executionEngine).toBe('rickydata-code');
      expect(JSON.parse(fetchSpy.mock.calls[2][1]!.body as string)).toEqual({
        model: 'claude-haiku-4-5-20251001',
        executionEngine: 'rickydata-code',
      });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const result = await client.listAgents();

      expect(result).toEqual(agents);
      expect(fetch).toHaveBeenCalledWith(`${GATEWAY}/agents`);
    });

    it('throws on list agents failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.listAgents()).rejects.toThrow('Failed to list agents: 500');
    });
  });

  // ─── API Key Management ─────────────────────────────────

  describe('configureApiKey', () => {
    it('rejects invalid API key format', async () => {
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await expect(client.configureApiKey('invalid-key')).rejects.toThrow('must start with "sk-ant-"');
    });

    it('stores API key via sign-to-derive PUT /wallet/apikey when a signer is available', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Auth
      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        // Provider-vault derive challenge
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'derive-nonce', message: 'Sign provider vault' }) } as Response)
        // Store API key
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, configured: true, encryptionMode: 'sign-to-derive' }) } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      await client.configureApiKey('sk-ant-test-key');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/wallet/provider-vault/derive-challenge`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
        }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/wallet/apikey`,
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"anthropicApiKey":"sk-ant-test-key"'),
        }),
      );
      expect(fetchSpy.mock.calls.find(call => call[0] === `${GATEWAY}/wallet/apikey`)?.[1]).toEqual(
        expect.objectContaining({
          body: expect.stringContaining('"nonce":"derive-nonce"'),
        }),
      );
    });
  });

  describe('setProviderApiKey', () => {
    it('stores OpenCode Go API keys in the wallet provider vault', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'derive-nonce', message: 'Sign provider vault' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, configured: true, encryptionMode: 'sign-to-derive' }) } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const status = await client.setProviderApiKey('opencode', 'sk-opencode-test-key');

      expect(status.configured).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/wallet/provider-vault/derive-challenge`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jwt' }),
        }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/wallet/opencode-apikey`,
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"opencodeApiKey":"sk-opencode-test-key"'),
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const result = await client.isApiKeyConfigured();
      expect(result).toBe(true);
    });

    it('returns false when key is not configured', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      fetchSpy
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: 'jwt' }) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ configured: false }) } as Response);

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
      const result = await client.isApiKeyConfigured();
      expect(result).toBe(false);
    });
  });

  describe('secret storage sign-to-derive', () => {
    it('stores MCP secrets with signature and nonce when a signer is available', async () => {
      const signMessage = vi.fn().mockResolvedValue('0xs2d-signature');
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'Sign MCP secrets derive message', nonce: 'mcp-nonce' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, encryptionMode: 'sign-to-derive' }),
        } as Response);

      const client = new AgentClient({ token: 'jwt-token-123', signMessage, sessionStorePath: null });
      await client.storeMcpSecrets('server-1', { API_KEY: 'secret-value' });

      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        `${GATEWAY}/wallet/mcp-secrets/derive-challenge`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jwt-token-123' }),
        }),
      );
      expect(signMessage).toHaveBeenCalledWith('Sign MCP secrets derive message');
      const request = fetchSpy.mock.calls[1][1] as RequestInit;
      expect(fetchSpy.mock.calls[1][0]).toBe(`${GATEWAY}/wallet/mcp-secrets/server-1`);
      expect(JSON.parse(request.body as string)).toEqual({
        secrets: { API_KEY: 'secret-value' },
        signature: '0xs2d-signature',
        nonce: 'mcp-nonce',
      });
    });

    it('stores agent secrets with signature and nonce when a signer is available', async () => {
      const signMessage = vi.fn().mockResolvedValue('0xagent-s2d-signature');
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'Sign agent secrets derive message', nonce: 'agent-nonce' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, encryptionMode: 'sign-to-derive' }),
        } as Response);

      const client = new AgentClient({ token: 'jwt-token-123', signMessage, sessionStorePath: null });
      await client.storeAgentSecrets('agent-1', { API_KEY: 'secret-value' });

      expect(fetchSpy).toHaveBeenNthCalledWith(
        1,
        `${GATEWAY}/wallet/agent-secrets/derive-challenge`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer jwt-token-123' }),
        }),
      );
      expect(signMessage).toHaveBeenCalledWith('Sign agent secrets derive message');
      const request = fetchSpy.mock.calls[1][1] as RequestInit;
      expect(fetchSpy.mock.calls[1][0]).toBe(`${GATEWAY}/wallet/agent-secrets/agent-1`);
      expect(JSON.parse(request.body as string)).toEqual({
        secrets: { API_KEY: 'secret-value' },
        signature: '0xagent-s2d-signature',
        nonce: 'agent-nonce',
      });
    });

    it('keeps the legacy MCP secret body for token-only clients without a signer', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) } as Response);

      const client = new AgentClient({ token: 'jwt-token-123', sessionStorePath: null });
      await client.storeMcpSecrets('server-1', { API_KEY: 'secret-value' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(`${GATEWAY}/wallet/mcp-secrets/server-1`);
      expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toEqual({
        secrets: { API_KEY: 'secret-value' },
      });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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
      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

      const client = new AgentClient({ privateKey: PRIVATE_KEY, sessionStorePath: null });
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

  describe('voice', () => {
    it('sends the full LiveKit voice token request body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          token: 'lk-token',
          url: 'wss://livekit.example',
          roomName: 'voice-room',
          sessionId: 'session-1',
          provider: 'livekit',
        }),
      } as Response);

      const client = new AgentClient({ token: 'wallet-token', sessionStorePath: null });
      const result = await client.getVoiceLivekitToken('test-agent', {
        voice: 'voice-id',
        model: 'claude-haiku-4-5-20251001',
        resumeSessionId: 'existing-session',
        executionEngine: 'rickydata-code',
        ttsProvider: 'gemini-live',
        ttsModel: 'gemini-3.1-flash-live-preview',
        ttsVoice: 'Kore',
        narratorEnabled: true,
        parallelNarrator: true,
      });

      expect(result.sessionId).toBe('session-1');
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/agents/test-agent/voice/livekit-token`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer wallet-token' }),
          body: JSON.stringify({
            voice: 'voice-id',
            model: 'claude-haiku-4-5-20251001',
            resumeSessionId: 'existing-session',
            executionEngine: 'rickydata-code',
            ttsProvider: 'gemini-live',
            ttsModel: 'gemini-3.1-flash-live-preview',
            ttsVoice: 'Kore',
            narratorEnabled: true,
            parallelNarrator: true,
          }),
        }),
      );
    });
  });
});

describe('AgentClient — Anthropic OAuth (Claude Code subscription)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a credential bundle via a wallet-signed PUT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // derive-challenge
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Sign Anthropic OAuth', nonce: 'oauth-nonce' }),
    } as Response);
    // PUT
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ configured: true, hasTokens: true, encryptionMode: 'sign-to-derive' }),
    } as Response);

    // privateKey path (CLI/Node) — viem signs the gateway-issued message.
    const client = new AgentClient({ token: 'wallet-token', privateKey: PRIVATE_KEY, gatewayUrl: GATEWAY, sessionStorePath: null });

    const bundle = {
      claudeAiOauth: {
        accessToken: 'sk-ant-oat-SECRET',
        refreshToken: 'sk-ant-ort-SECRET',
        expiresAt: 123,
        scopes: ['user:inference'],
      },
    };
    const status = await client.setAnthropicOAuth(bundle);

    expect(status.configured).toBe(true);
    const putCall = fetchSpy.mock.calls.find(([url, init]) => url === `${GATEWAY}/wallet/anthropic-oauth` && (init as RequestInit)?.method === 'PUT');
    expect(putCall).toBeDefined();
    const putBody = JSON.parse((putCall![1] as RequestInit).body as string);
    // SHARED CONTRACT: the gateway reads the bundle from `credentials`.
    expect(putBody.credentials).toEqual(bundle);
    expect(putBody.nonce).toBe('oauth-nonce');
    expect(putBody.signature).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('reads status without signing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ configured: true, hasTokens: true, scopes: ['user:profile'] }),
    } as Response);

    const client = new AgentClient({ token: 'wallet-token', gatewayUrl: GATEWAY, sessionStorePath: null });
    const status = await client.getAnthropicOAuthStatus();

    expect(status.configured).toBe(true);
    expect(status.scopes).toEqual(['user:profile']);
    expect(fetchSpy).toHaveBeenCalledWith(
      `${GATEWAY}/wallet/anthropic-oauth/status`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer wallet-token' }) }),
    );
  });

  it('unlocks via a wallet-signed POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ message: 'Sign Anthropic OAuth', nonce: 'n' }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ configured: true, unlocked: true }),
    } as Response);

    const client = new AgentClient({ token: 'wallet-token', privateKey: PRIVATE_KEY, gatewayUrl: GATEWAY, sessionStorePath: null });
    const status = await client.unlockAnthropicOAuth();

    expect(status.unlocked).toBe(true);
    const postCall = fetchSpy.mock.calls.find(([url]) => url === `${GATEWAY}/wallet/anthropic-oauth/unlock`);
    expect(postCall).toBeDefined();
    expect((postCall![1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((postCall![1] as RequestInit).body as string).signature).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('deletes via DELETE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce({ ok: true } as Response);

    const client = new AgentClient({ token: 'wallet-token', gatewayUrl: GATEWAY, sessionStorePath: null });
    await client.deleteAnthropicOAuth();

    expect(fetchSpy).toHaveBeenCalledWith(
      `${GATEWAY}/wallet/anthropic-oauth`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
