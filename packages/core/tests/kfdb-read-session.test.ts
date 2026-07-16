import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KFDBClient, KfdbReadSession } from '../src/kfdb/index.js';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('KfdbReadSession', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('coalesces equal reads for the lifetime of one request session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      label: 'OpenQuestion', items: [{ _id: 'q1' }], total: 1, limit: 10, offset: 0, source: 'kfdb-scylladb',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new KFDBClient({ baseUrl: 'https://kfdb.example', token: 'token' });
    const reads = client.readSession({ scope: 'private' });

    const [a, b] = await Promise.all([
      reads.listEntities('OpenQuestion', { limit: 10, fields: ['status', 'question'] }),
      reads.listEntities('OpenQuestion', { fields: ['status', 'question'], limit: 10 }),
    ]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('scope=private');
  });

  it('chunks large batch reads at the KFDB 100-entity boundary and merges results', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as { entities: Array<{ label: string; id: string }> };
      return response({
        entities: Object.fromEntries(request.entities.map((ref) => [`${ref.label}:${ref.id}`, { value: ref.id }])),
        missing: [],
        resolved: request.entities.length,
        requested: request.entities.length,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new KFDBClient({ baseUrl: 'https://kfdb.example', token: 'token' });
    const reads = new KfdbReadSession(client, { scope: 'private' });
    const entities = Array.from({ length: 205 }, (_, index) => ({ label: 'Run', id: `r${index}` }));

    const result = await reads.batchGetEntities({ entities });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.requested).toBe(205);
    expect(result.resolved).toBe(205);
    expect(Object.keys(result.entities)).toHaveLength(205);
  });

  it('does not share reads across explicit sessions', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({
      label: 'Run', items: [], total: 0, limit: 1, offset: 0, source: 'kfdb-scylladb',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new KFDBClient({ baseUrl: 'https://kfdb.example', token: 'token' });

    await client.readSession({ scope: 'private' }).listEntities('Run', { limit: 1 });
    await client.readSession({ scope: 'private' }).listEntities('Run', { limit: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts rejected reads so a transient failure can be retried in the same session', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(response({
        label: 'Run', items: [], total: 0, limit: 1, offset: 0, source: 'kfdb-scylladb',
      }));
    vi.stubGlobal('fetch', fetchMock);
    const reads = new KFDBClient({ baseUrl: 'https://kfdb.example', token: 'token' })
      .readSession({ scope: 'private' });

    await expect(reads.listEntities('Run', { limit: 1 })).rejects.toThrow('temporary network failure');
    await expect(reads.listEntities('Run', { limit: 1 })).resolves.toMatchObject({ label: 'Run' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
