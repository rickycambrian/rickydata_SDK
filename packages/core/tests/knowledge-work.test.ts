import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
});
