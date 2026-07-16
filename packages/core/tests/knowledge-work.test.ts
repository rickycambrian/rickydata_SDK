import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MemoryKnowledgeWorkCacheStore,
  KnowledgeWorkClient,
  KnowledgeWorkHttpError,
  createKnowledgeWorkPipeline,
  type KnowledgeContextPack,
} from '../src/knowledge/index.js';

const PACK: KnowledgeContextPack = {
  version: 'context-pack/v1',
  compiled_at: '2026-07-16T10:00:00.000Z',
  reproducibility_hash: 'abc123',
  token_estimate: 420,
  anchor: { kind: 'repo', repoId: 'rickydata_home' },
  brief: 'Make the verified knowledge loop easy to operate.',
  invariants: [{ text: 'Keep tenant reads private.', source_ref: 'wiki:privacy' }],
  verification: [],
  work_in_progress: [{ id: 'work-1' }],
  wiki: [{ slug: 'context-packs', title: 'Context packs', summary: 'Compiled knowledge.', status: 'approved', rank_reason: 'repo' }],
  lessons: [],
  decisions: [],
  traps: [{ name: 'private-read', hook: 'Use a derive client.' }],
  open_questions: [],
  omitted: [{ section: 'decisions', count: 3, reason: 'budget' }],
  coverage: { status: 'bounded', sources: [{ source: 'wiki', status: 'ok', count: 1 }] },
  selected_items: [],
  omitted_items: [],
};

describe('knowledge work SDK', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('turns a context pack into stable, honest pipeline steps', () => {
    const pipeline = createKnowledgeWorkPipeline(PACK);

    expect(pipeline.version).toBe('knowledge-work/v1');
    expect(pipeline.anchor).toEqual({ kind: 'repo', key: 'rickydata_home' });
    expect(pipeline.steps.map((step) => step.id)).toEqual([
      'orient', 'constraints', 'current-work', 'evidence', 'knowledge', 'decisions', 'questions',
    ]);
    expect(pipeline.steps.find((step) => step.id === 'constraints')).toMatchObject({ status: 'ready', itemCount: 2 });
    expect(pipeline.steps.find((step) => step.id === 'decisions')).toMatchObject({ status: 'omitted', itemCount: 0, omittedCount: 3 });
    expect(pipeline.coverage).toBe('bounded');
  });

  it('fetches an authenticated host-owned pack and coalesces concurrent requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(PACK), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new KnowledgeWorkClient({
      baseUrl: 'https://home.example',
      fetch: fetchMock,
      headers: async () => ({ Authorization: 'Bearer wallet-session' }),
      consumer: 'ui-next',
    });

    const [a, b] = await Promise.all([
      client.getPipeline({ kind: 'repo', key: 'rickydata_home' }),
      client.getPipeline({ kind: 'repo', key: 'rickydata_home' }),
    ]);

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://home.example/api/context-pack?repo=rickydata_home&consumer=ui-next');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer wallet-session');
  });

  it('surfaces typed HTTP failures without leaking response bodies into callers', async () => {
    const client = new KnowledgeWorkClient({
      baseUrl: 'https://home.example',
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'anchor not found' }), { status: 400 })),
    });

    await expect(client.getContextPack({ kind: 'task', key: 'missing' })).rejects.toMatchObject({
      name: 'KnowledgeWorkHttpError', status: 400, message: 'anchor not found',
    } satisfies Partial<KnowledgeWorkHttpError>);
  });

  it('reuses immutable snapshot entries sequentially within one tenant and emits cache metrics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(PACK), {
      status: 200,
      headers: { 'x-rickydata-context-snapshot-hash': 'f'.repeat(64) },
    }));
    const events: string[] = [];
    const client = new KnowledgeWorkClient({
      fetch: fetchMock,
      cache: new MemoryKnowledgeWorkCacheStore(),
      cacheScope: () => '0xabc',
      onCacheEvent: (event) => events.push(event.type),
    });

    const first = await client.getPipeline({ kind: 'repo', key: 'rickydata_home' });
    const second = await client.getPipeline({ kind: 'repo', key: 'rickydata_home' });

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['miss', 'write', 'hit']);
  });

  it('isolates cache entries by tenant and clears the prior tenant on wallet change', async () => {
    let scope = 'wallet-a';
    const cache = new MemoryKnowledgeWorkCacheStore();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(PACK), { status: 200 }));
    const client = new KnowledgeWorkClient({ fetch: fetchMock, cache, cacheScope: () => scope });

    await client.getPipeline({ kind: 'repo', key: 'rickydata_home' });
    scope = 'wallet-b';
    await client.getPipeline({ kind: 'repo', key: 'rickydata_home' });
    scope = 'wallet-a';
    await client.getPipeline({ kind: 'repo', key: 'rickydata_home' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('serves stale data immediately while one background refresh updates the snapshot', async () => {
    let now = 0;
    let release!: () => void;
    const refresh = new Promise<void>((resolve) => { release = resolve; });
    const updated = { ...PACK, reproducibility_hash: 'updated', compiled_at: '2026-07-16T10:01:00.000Z' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(PACK), { status: 200 }))
      .mockImplementationOnce(async () => { await refresh; return new Response(JSON.stringify(updated), { status: 200 }); });
    const events: string[] = [];
    const client = new KnowledgeWorkClient({
      fetch: fetchMock,
      cacheScope: () => 'wallet',
      cacheTtlMs: 10,
      staleWhileRevalidateMs: 100,
      now: () => now,
      onCacheEvent: (event) => events.push(event.type),
    });
    const anchor = { kind: 'repo', key: 'rickydata_home' } as const;

    await client.getPipeline(anchor);
    now = 20;
    const [a, b] = await Promise.all([client.getPipeline(anchor), client.getPipeline(anchor)]);
    expect(a.reproducibilityHash).toBe('abc123');
    expect(b.reproducibilityHash).toBe('abc123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    release();
    await vi.waitFor(async () => expect((await client.getPipeline(anchor)).reproducibilityHash).toBe('updated'));
    expect(events).toContain('stale');
    expect(events).toContain('refresh');
  });

  it('bounds the default memory store by least-recently-used entries', async () => {
    const store = new MemoryKnowledgeWorkCacheStore({ maxEntries: 2 });
    const entry = { storedAt: 1, pack: PACK };
    await store.set('tenant:a', entry);
    await store.set('tenant:b', entry);
    await store.get('tenant:a');
    await store.set('tenant:c', entry);
    expect(await store.get('tenant:a')).not.toBeNull();
    expect(await store.get('tenant:b')).toBeNull();
    expect(await store.get('tenant:c')).not.toBeNull();
  });
});
