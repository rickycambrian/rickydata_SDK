import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BenchmarkEvidenceClient } from '../src/research/benchmark-evidence-client.js';

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('BenchmarkEvidenceClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists public live runs with optional config filtering and auth header when supplied', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({
      rows: [
        { run_id: 'run-1', config_id: 'rickydata-code' },
        { run_id: 'run-2', config_id: 'claude-code' },
      ],
      total: 2,
    }));

    const client = new BenchmarkEvidenceClient({ token: 'bench-token' });
    const result = await client.listLiveRuns({
      repo: 'Textualize/rich',
      campaignId: 'benchmark_matrix_current',
      config: 'rickydata-code',
      limit: 100,
    });

    expect(result.rows).toEqual([{ run_id: 'run-1', config_id: 'rickydata-code' }]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://benchmarks.rickydata.org/api/benchmarks/live?repo=Textualize%2Frich&campaign_id=benchmark_matrix_current&limit=100',
    );
    expect((init?.headers as Headers).get('authorization')).toBe('Bearer bench-token');
  });

  it('fetches run history through the public benchmark API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ rows: [{ run_id: 'run-3' }] }));

    const client = new BenchmarkEvidenceClient({ baseUrl: 'https://bench.example.test/' });
    const result = await client.getRunHistory({
      repo: 'denoland/deno',
      campaignId: 'campaign-a',
      issueNumber: 123,
      config: 'rickydata-code',
      limit: 50,
    });

    expect(result.rows).toEqual([{ run_id: 'run-3' }]);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://bench.example.test/api/benchmarks/runs/history?repo=denoland%2Fdeno&campaign_id=campaign-a&issue_number=123&config=rickydata-code&limit=50',
    );
  });

  it('fetches trace read models without requiring private credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ traceKgRef: 'kg://trace/run-1' }));

    const client = new BenchmarkEvidenceClient({ baseUrl: 'https://bench.example.test' });
    const result = await client.getTraceReadModel('kg://trace/run-1');

    expect(result.traceKgRef).toBe('kg://trace/run-1');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://bench.example.test/api/benchmarks/traces/kg%3A%2F%2Ftrace%2Frun-1');
  });

  it('executes proof-backed runs only when an auth token is present', async () => {
    const client = new BenchmarkEvidenceClient();
    await expect(client.executeProofBackedRun({
      repo: 'Textualize/rich',
      issue_number: 3577,
      campaign_id: 'benchmark_matrix_current',
      config: 'rickydata-code',
      visibility: 'public',
      data_scope: 'public_repo',
      write_scope: 'public_benchmark_graph',
      proof_required: true,
      trace_required: true,
    })).rejects.toThrow('executeProofBackedRun requires token or apiKey');
  });

  it('posts proof-backed run requests to the agent gateway', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({
      run_id: 'run-4',
      proof_verified: true,
      trace_kg_ref: 'kg://trace/run-4',
    }));

    const client = new BenchmarkEvidenceClient({
      agentGatewayUrl: 'https://agents.example.test/',
      token: 'bench-token',
    });
    const result = await client.executeProofBackedRun({
      repo: 'Textualize/rich',
      issue_number: 3577,
      campaign_id: 'benchmark_matrix_current',
      config: 'rickydata-code',
      visibility: 'public',
      data_scope: 'public_repo',
      write_scope: 'public_benchmark_graph',
      proof_required: true,
      trace_required: true,
    });

    expect(result.run_id).toBe('run-4');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://agents.example.test/api/benchmark/runs/execute-proof-backed');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Headers).get('authorization')).toBe('Bearer bench-token');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      repo: 'Textualize/rich',
      issue_number: 3577,
      proof_required: true,
      trace_required: true,
    });
  });
});
