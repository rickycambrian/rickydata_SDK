import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KFDBClient } from '../src/kfdb/index.js';

describe('KFDBClient.getKnowledgeBundle', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses the public authenticated bundle endpoint with typed exhaustive options', async () => {
    const body = { pages: [], claims: [], open_questions: [], diagnostics: { complete: true } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new KFDBClient({
      baseUrl: 'https://kfdb.example', token: 'token', walletAddress: '0xabc', defaultReadScope: 'private',
    });

    await expect(client.getKnowledgeBundle({ exhaustive: true, scanPageSize: 2_000, scanLimit: 50_000 }))
      .resolves.toEqual(body);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kfdb.example/api/v1/agent/knowledge');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    expect(new Headers(init.headers).get('x-wallet-address')).toBe('0xabc');
    expect(JSON.parse(String(init.body))).toEqual({ exhaustive: true, scan_page_size: 2000, scan_limit: 50000 });
  });
});
