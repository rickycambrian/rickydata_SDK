import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KFDBClient } from '../src/kfdb/client.js';
import { kfdbValue } from '../src/kfdb/index.js';

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

  it('withScope preserves active derive session headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ label: 'Note', items: [], total: 0, limit: 100, offset: 0, source: 'kfdb-scylladb' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({
      baseUrl: BASE,
      token: 'tok_123',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    });
    client.setDeriveSession('derive-session', 'a'.repeat(64));

    await client.withScope('private').listEntities('Note');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('x-derive-session-id')).toBe('derive-session');
    expect(headers.get('x-derive-key')).toBe('a'.repeat(64));
  });

  it('posts KQL, SQL, and explain query helpers to KFDB endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({ rows: [{ total: 1 }], execution_time_ms: 2 }))
      .mockResolvedValueOnce(mockJsonResponse({ rows: [{ count: 1 }], execution_time_ms: 3 }))
      .mockResolvedValueOnce(mockJsonResponse({ plan: { root: 'scan' } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await client.queryKql('MATCH (n:File) RETURN COUNT(n) AS total', { scope: 'private' });
    await client.querySql("SELECT COUNT(*) FROM nodes_by_label WHERE label='File'");
    await client.explainKql('MATCH (n:File) RETURN n LIMIT 1');

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/query`);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      query: 'MATCH (n:File) RETURN COUNT(n) AS total',
      scope: 'private',
    });
    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/api/v1/query/sql`);
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
      query: "SELECT COUNT(*) FROM nodes_by_label WHERE label='File'",
    });
    expect(fetchMock.mock.calls[2][0]).toBe(`${BASE}/api/v1/query/explain`);
  });

  it('passes explicit KQL page sizing and cursors to the query endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ data: [], has_more: false }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await client.queryKql('MATCH (n:Note) RETURN n.*', {
      scope: 'private',
      pageSize: 5_000,
      cursor: 'ledger-page-2',
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      query: 'MATCH (n:Note) RETURN n.*',
      scope: 'private',
      page_size: 5_000,
      cursor: 'ledger-page-2',
    });
  });

  it('deletes an entity embedding through the tenant-aware endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        label: 'WikiPage',
        node_id: '550e8400-e29b-41d4-a716-446655440000',
        deleted: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    const response = await client.deleteEntityEmbedding({
      label: 'WikiPage',
      nodeId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.deleted).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/entities/embed`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({
      label: 'WikiPage',
      node_id: '550e8400-e29b-41d4-a716-446655440000',
    });
  });

  it('embeds entities through one typed batch request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ embedded: 2, errors: 0, results: [], error_details: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    const response = await client.embedEntitiesBatch({
      entities: [
        {
          label: 'WikiPage',
          nodeId: '550e8400-e29b-41d4-a716-446655440000',
          text: 'Incremental semantic maintenance',
        },
        {
          label: 'OpenQuestion',
          nodeId: '550e8400-e29b-41d4-a716-446655440001',
          properties: ['question'],
        },
      ],
    });

    expect(response).toMatchObject({ embedded: 2, errors: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/entities/embed/model-batch`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      entities: [
        {
          label: 'WikiPage',
          node_id: '550e8400-e29b-41d4-a716-446655440000',
          text: 'Incremental semantic maintenance',
        },
        {
          label: 'OpenQuestion',
          node_id: '550e8400-e29b-41d4-a716-446655440001',
          properties: ['question'],
        },
      ],
    });
  });

  it('exports KFDB property wrapper helpers', () => {
    expect(kfdbValue.string('hello')).toEqual({ String: 'hello' });
    expect(kfdbValue.integer(42)).toEqual({ Integer: 42 });
    expect(kfdbValue.float(3.14)).toEqual({ Float: 3.14 });
    expect(kfdbValue.boolean(true)).toEqual({ Boolean: true });
    expect(kfdbValue.vector([0.1, 0.2])).toEqual({ Vector: [0.1, 0.2] });
    expect(kfdbValue.auto(null)).toBeNull();
    expect(kfdbValue.auto(['a', 'b'])).toEqual({ String: '["a","b"]' });
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

  it('sends sparse field projections and abort signals through entity list reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ label: 'RickydataLintRun', items: [], total: 0, limit: 1, offset: 0, source: 'kfdb-scylladb' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await client.listEntities('RickydataLintRun', {
      scope: 'private',
      limit: 1,
      fields: ['run_id', 'findings_json'],
      signal: controller.signal,
    });

    const url = fetchMock.mock.calls[0][0] as string;
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url).toContain('fields=run_id%2Cfindings_json');
    expect(init.signal).toBe(controller.signal);
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

  it('acquires an immutable private KV claim with derive headers and exact LWT body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ success: true, message: 'claimed', acquired: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key', walletAddress });
    client.setDeriveSession('derive-session', 'c'.repeat(64));
    const result = await client.claimImmutablePrivateKv(
      'immutable-claim:private-bench:v1:abc',
      { ownerNonce: 'd'.repeat(64) },
    );

    expect(result).toEqual({ success: true, message: 'claimed', acquired: true });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/kv`);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      key: 'immutable-claim:private-bench:v1:abc',
      value: { ownerNonce: 'd'.repeat(64) },
      if_absent: true,
    });
    const headers = new Headers((init.headers ?? {}) as HeadersInit);
    expect(headers.get('x-wallet-address')).toBe(walletAddress);
    expect(headers.get('x-derive-session-id')).toBe('derive-session');
  });

  it('returns the immutable winner for exact crash recovery and rejects malformed responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        success: true,
        message: 'exists',
        acquired: false,
        existing_value: { ownerNonce: 'e'.repeat(64) },
      }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, message: 'bad' }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await expect(client.claimImmutablePrivateKv('immutable-claim:private-bench:v1:def', {}))
      .resolves.toEqual({
        success: true,
        message: 'exists',
        acquired: false,
        existingValue: { ownerNonce: 'e'.repeat(64) },
      });
    await expect(client.claimImmutablePrivateKv('immutable-claim:private-bench:v1:ghi', {}))
      .rejects.toThrow('omitted its LWT acquired result');
  });

  it('reads immutable private KV authority without issuing a mutating request', async () => {
    const key = 'immutable-claim:private-bench:v1:abc';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        success: true,
        key,
        value: { ownerNonce: 'f'.repeat(64) },
        updated_at: 123,
        message: 'Value retrieved',
      }))
      .mockResolvedValueOnce(mockJsonResponse({ success: false, message: 'Key not found' }));
    vi.stubGlobal('fetch', fetchMock);

    const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key', walletAddress });
    client.setDeriveSession('derive-session', 'a'.repeat(64));

    await expect(client.getImmutablePrivateKv(key)).resolves.toEqual({
      found: true,
      value: { ownerNonce: 'f'.repeat(64) },
      updatedAt: 123,
    });
    await expect(client.getImmutablePrivateKv('immutable-claim:private-bench:v1:missing'))
      .resolves.toEqual({ found: false });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/kv/${encodeURIComponent(key)}`);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBeUndefined();
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers as HeadersInit);
    expect(headers.get('x-derive-session-id')).toBe('derive-session');
  });

  it('reads immutable content artifacts through the derive-authenticated private KV seam', async () => {
    const key = `content-artifact:sha256:${'a'.repeat(64)}`;
    const value = {
      contractVersion: 'content-artifact/v1',
      contentHash: `sha256:${'a'.repeat(64)}`,
      byteLength: 5,
      content: 'hello',
    };
    const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse({ success: true, key, value }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({
      baseUrl: BASE,
      apiKey: 'kfdb_api_key',
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    });
    client.setDeriveSession('derive-session', 'a'.repeat(64));

    await expect(client.getPrivateKv(key)).resolves.toEqual({ found: true, value });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/kv/${encodeURIComponent(key)}`);
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers as HeadersInit);
    expect(headers.get('x-derive-session-id')).toBe('derive-session');
    await expect(client.getPrivateKv('unscoped-key')).rejects.toThrow('supported immutable namespace');
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

  it('writes Hermes hook traces through the deterministic KG builder', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 5 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const walletAddress = '0x75992f829DF3B5d515D70DB0f77A98171cE261EF';
    const client = new KFDBClient({ baseUrl: BASE, apiKey: 'kfdb_api_key', walletAddress });
    client.setDeriveSession('derive-session', 'b'.repeat(64));
    await client.writeHermesHookTrace({
      walletAddress,
      agentId: 'agent:hermes',
      sessionId: 'session-1',
      turnIndex: 1,
      hermesSessionId: 'hermes-session-1',
      provider: 'openai-codex',
      model: 'gpt-5.5',
      startedAt: 1,
      completedAt: 2,
      events: [{
        sequence: 0,
        hookEventName: 'agent:end',
        hermesSessionId: 'hermes-session-1',
        receivedAt: 2,
        response: 'done',
      }],
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.skip_embedding).toBe(true);
    expect(body.operations.map((op: { label?: string }) => op.label)).toContain('HermesHookEvent');
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

  it('sends shared notebook key enrollment and sharing request shapes', async () => {
    const wrappedGroupKey = {
      version: 1 as const,
      alg: 'X25519-HKDF-SHA256-AES-256-GCM' as const,
      ephemeral_public_key: 'eph_pk_b64',
      salt: 'salt_b64',
      nonce: 'nonce_b64',
      ciphertext: 'ciphertext_b64',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockJsonResponse({
        key_id: 'sharing-key-1',
        public_key: 'recipient_pk_b64',
        algorithm: 'X25519',
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        keys: [{
          key_id: 'sharing-key-1',
          public_key: 'recipient_pk_b64',
          algorithm: 'X25519',
        }],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        notebook_id: '550e8400-e29b-41d4-a716-446655440000',
        workspace_id: '650e8400-e29b-41d4-a716-446655440000',
        current_version: 1,
        content_hash: 'sha256:abc',
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        notebook_id: 'notebook/with space',
        member: {
          wallet_address: '0xrecipient',
          role: 'editor',
          sharing_key_id: 'sharing-key-1',
          key_id: 'k1',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });
    await client.enrollSharingKey({
      public_key: 'recipient_pk_b64',
      label: 'Laptop',
      device_id: 'device-1',
    });
    await client.listSharingKeys();
    await client.createSharedNotebook({
      workspace_id: '650e8400-e29b-41d4-a716-446655440000',
      title_ciphertext: '__cenc_v2_group_k1.str:title',
      content_ciphertext: '__cenc_v2_group_k1.str:content',
      content_hash: 'sha256:abc',
      key_version: 'k1',
      dek_envelopes: [{
        wallet_address: '0xrecipient',
        wrapped_dek: 'opaque_dek_b64',
        key_version: 'k1',
      }],
    });
    await client.shareNotebook('notebook/with space', {
      recipient_wallet_address: '0xrecipient',
      recipient_sharing_key_id: 'sharing-key-1',
      role: 'editor',
      key_id: 'k1',
      wrapped_group_key: wrappedGroupKey,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/shared-notebooks/keys/enroll`);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      public_key: 'recipient_pk_b64',
      algorithm: 'X25519',
      label: 'Laptop',
      device_id: 'device-1',
    });

    expect(fetchMock.mock.calls[1][0]).toBe(`${BASE}/api/v1/shared-notebooks/keys`);
    expect(fetchMock.mock.calls[2][0]).toBe(`${BASE}/api/v1/shared-notebooks`);
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({
      workspace_id: '650e8400-e29b-41d4-a716-446655440000',
      title_ciphertext: '__cenc_v2_group_k1.str:title',
      content_ciphertext: '__cenc_v2_group_k1.str:content',
      content_hash: 'sha256:abc',
      key_version: 'k1',
      dek_envelopes: [{
        wallet_address: '0xrecipient',
        wrapped_dek: 'opaque_dek_b64',
        key_version: 'k1',
      }],
    });

    expect(fetchMock.mock.calls[3][0]).toBe(`${BASE}/api/v1/shared-notebooks/notebook%2Fwith%20space/share`);
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body))).toEqual({
      recipient_wallet_address: '0xrecipient',
      recipient_sharing_key_id: 'sharing-key-1',
      role: 'editor',
      key_id: 'k1',
      wrapped_group_key: wrappedGroupKey,
    });
  });
});
