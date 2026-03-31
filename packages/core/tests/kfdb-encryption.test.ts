import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KFDBClient } from '../src/kfdb/client.js';
import { importKeyFromHex, encryptValue } from '../src/encryption.js';

const BASE = 'http://localhost:8080';
const TEST_KEY_HEX = '0x' + '01'.repeat(32);

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('KFDBClient auto-encryption', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    vi.restoreAllMocks();
    key = await importKeyFromHex(TEST_KEY_HEX);
  });

  // ── write() ────────────────────────────────────────────────────────

  it('write() encrypts properties when encryptionKey is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 1, execution_time_ms: 1, affected_ids: ['n1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key });
    await client.write({
      operations: [
        { operation: 'create_node', label: 'Note', properties: { title: { String: 'hello' } } },
      ],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const props = body.operations[0].properties;
    // Property value should be encrypted (wrapped in { String: "__cenc_v1_..." })
    expect(props.title).toHaveProperty('String');
    expect(props.title.String).toMatch(/^__cenc_v1_/);
  });

  it('write() passes through operations without properties', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 1, execution_time_ms: 1, affected_ids: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key });
    await client.write({
      operations: [{ operation: 'delete_node', id: 'n1' }],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.operations[0]).toEqual({ operation: 'delete_node', id: 'n1' });
  });

  it('write() does NOT encrypt when no encryptionKey', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 1, execution_time_ms: 1, affected_ids: ['n1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok' });
    await client.write({
      operations: [
        { operation: 'create_node', label: 'Note', properties: { title: { String: 'hello' } } },
      ],
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.operations[0].properties.title).toEqual({ String: 'hello' });
  });

  // ── listEntities() ────────────────────────────────────────────────

  it('listEntities() decrypts items when encryptionKey is set', async () => {
    const encTitle = await encryptValue(key, 'secret-title');
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        label: 'Note',
        items: [{ title: { String: encTitle }, label: 'Note' }],
        total: 1, limit: 100, offset: 0, source: 'scylladb',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key });
    const result = await client.listEntities('Note');

    expect(result.items[0].title).toBe('secret-title');
    expect(result.items[0].label).toBe('Note'); // non-encrypted passes through
  });

  it('listEntities() does NOT decrypt when no encryptionKey', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        label: 'Note',
        items: [{ title: 'plaintext' }],
        total: 1, limit: 100, offset: 0, source: 'scylladb',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok' });
    const result = await client.listEntities('Note');

    expect(result.items[0].title).toBe('plaintext');
  });

  // ── getEntity() ───────────────────────────────────────────────────

  it('getEntity() decrypts properties when encryptionKey is set', async () => {
    const encName = await encryptValue(key, 'my-note');
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        label: 'Note',
        id: 'n1',
        properties: { name: { String: encName }, id: 'n1' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key });
    const result = await client.getEntity('Note', 'n1');

    expect(result.properties.name).toBe('my-note');
    expect(result.properties.id).toBe('n1'); // non-encrypted
  });

  // ── filterEntities() ──────────────────────────────────────────────

  it('filterEntities() decrypts items when encryptionKey is set', async () => {
    const encBody = await encryptValue(key, 'secret-body');
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        label: 'Note',
        items: [{ body: encBody, label: 'Note' }],
        total: 1, limit: 100, offset: 0, source: 'scylladb',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key });
    const result = await client.filterEntities('Note', { filters: { label: 'Note' } });

    expect(result.items[0].body).toBe('secret-body');
  });

  // ── batchGetEntities() ────────────────────────────────────────────

  it('batchGetEntities() decrypts entity properties when encryptionKey is set', async () => {
    const encTitle = await encryptValue(key, 'batch-title');
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        entities: {
          'Note:n1': { title: { String: encTitle }, id: 'n1' },
        },
        missing: [],
        resolved: 1,
        requested: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key });
    const result = await client.batchGetEntities({
      entities: [{ label: 'Note', id: 'n1' }],
    });

    expect(result.entities['Note:n1'].title).toBe('batch-title');
    expect(result.entities['Note:n1'].id).toBe('n1');
  });

  // ── withScope() preserves encryptionKey ───────────────────────────

  it('withScope() preserves encryptionKey', async () => {
    const encTitle = await encryptValue(key, 'scoped-title');
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        label: 'Note',
        items: [{ title: { String: encTitle } }],
        total: 1, limit: 100, offset: 0, source: 'scylladb',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok', encryptionKey: key })
      .withScope('private');
    const result = await client.listEntities('Note');

    expect(result.items[0].title).toBe('scoped-title');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('scope=private');
  });

  // ── backward compatibility ────────────────────────────────────────

  it('client works normally without encryptionKey (backward compat)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        mockJsonResponse({ labels: [{ label: 'Note', count: 1 }], count: 1 }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          label: 'Note',
          items: [{ title: 'plain' }],
          total: 1, limit: 100, offset: 0, source: 'scylladb',
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({ operations_executed: 1, execution_time_ms: 1, affected_ids: ['n1'] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new KFDBClient({ baseUrl: BASE, token: 'tok' });

    const labels = await client.listLabels();
    expect(labels.count).toBe(1);

    const list = await client.listEntities('Note');
    expect(list.items[0].title).toBe('plain');

    const write = await client.write({
      operations: [{ operation: 'create_node', label: 'Note', properties: { title: { String: 'plain' } } }],
    });
    expect(write.operations_executed).toBe(1);
  });
});
