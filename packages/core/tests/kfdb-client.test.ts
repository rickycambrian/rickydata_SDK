import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KFDBClient } from '../src/kfdb/client.js';

const BASE = 'http://localhost:8080';

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('KFDBClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults read calls to scope=global', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ labels: [{ label: 'MCPServer', count: 1 }], count: 1 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await client.listLabels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/entities/labels?scope=global`);
  });

  it('withScope(private) overrides read scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ label: 'Note', items: [], total: 0, limit: 100, offset: 0, source: 'kfdb-scylladb' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' }).withScope('private');
    await client.listEntities('Note');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/entities/Note?');
    expect(url).toContain('scope=private');
  });

  it('per-call scope override beats client default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ label: 'Note', items: [], total: 0, limit: 100, offset: 0, source: 'kfdb-scylladb' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123', defaultReadScope: 'global' });
    await client.listEntities('Note', { scope: 'private', limit: 10 });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('scope=private');
    expect(url).toContain('limit=10');
  });

  it('write hits /api/v1/write with no scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 1, execution_time_ms: 2.3, affected_ids: ['node-1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await client.write({ operations: [{ operation: 'create_node', label: 'Note', properties: {} }] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/write`);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.scope).toBeUndefined();
    expect(body.operations).toHaveLength(1);
  });

  it('formats Authorization header with bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ labels: [], count: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_abc' });
    await client.listLabels();

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('authorization')).toBe('Bearer tok_abc');
  });

  it('formats Authorization header with bearer apiKey when token not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ labels: [], count: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key' });
    await client.listLabels('private');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('authorization')).toBe('Bearer kfdb_api_key');
  });

  it('sends wallet tenant header when walletAddress is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ labels: [], count: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key', walletAddress });
    await client.listLabels('private');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('x-wallet-address')).toBe(walletAddress);
  });

  it('writes Codex hook traces through the deterministic KG builder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 5 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const walletAddress = '0x75992f829DF3B5d515D70DB0f77A98171cE261EF';
    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key', walletAddress });
    client.setDeriveSession('derive-session', 'b'.repeat(64));
    await client.writeCodexHookTrace({
      walletAddress,
      agentId: 'erc8004-expert',
      sessionId: 'session-1',
      turnIndex: 1,
      codexSessionId: 'codex-session-1',
      turnId: 'turn-1',
      startedAt: 1,
      completedAt: 2,
      events: [{
        sequence: 0,
        hookEventName: 'Stop',
        codexSessionId: 'codex-session-1',
        turnId: 'turn-1',
        receivedAt: 2,
        lastAssistantMessage: 'done',
      }],
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.skip_embedding).toBe(true);
    expect(body.operations.map((op: { label?: string }) => op.label)).toContain('CodexHookEvent');
  });

  it('writes Claude Code hook traces through the deterministic KG builder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 5 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const walletAddress = '0x75992f829DF3B5d515D70DB0f77A98171cE261EF';
    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key', walletAddress });
    client.setDeriveSession('derive-session', 'b'.repeat(64));
    await client.writeClaudeCodeHookTrace({
      walletAddress,
      agentId: 'erc8004-expert',
      sessionId: 'session-1',
      turnIndex: 1,
      claudeSessionId: 'claude-session-1',
      startedAt: 1,
      completedAt: 2,
      events: [{
        sequence: 0,
        hookEventName: 'Stop',
        claudeSessionId: 'claude-session-1',
        receivedAt: 2,
      }],
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.skip_embedding).toBe(true);
    expect(body.operations.map((op: { label?: string }) => op.label)).toContain('ClaudeCodeHookEvent');
  });

  it('injects resolved scope into filter and batch request bodies', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockJsonResponse({ label: 'Note', items: [], total: 0, limit: 100, offset: 0, source: 'kfdb-scylladb' }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ entities: {}, missing: [], resolved: 0, requested: 0 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123', defaultReadScope: 'global' });

    await client.filterEntities('Note', { filters: { title: 'x' } });
    await client.batchGetEntities({ entities: [] });

    const filterInit = fetchMock.mock.calls[0][1] as RequestInit;
    const filterBody = JSON.parse(String(filterInit.body));
    expect(filterBody.scope).toBe('global');

    const batchInit = fetchMock.mock.calls[1][1] as RequestInit;
    const batchBody = JSON.parse(String(batchInit.body));
    expect(batchBody.scope).toBe('global');
  });
});
