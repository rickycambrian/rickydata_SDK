import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BenchmarkClient } from '../src/benchmarks/benchmark-client.js';

describe('BenchmarkClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends extended task fields when creating a task', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        task_id: 'task-1',
        tenant_id: 'tenant-1',
        source_repo: 'owner/repo',
        issue_number: 42,
        issue_title: 'Fix bug',
        sanitized_prompt: 'Fix it',
        campaign_id: 'camp-1',
        base_commit: 'abc',
        gold_diff: '',
        gold_files_changed: [],
        language: 'python',
        issue_type: 'bug_fix',
        complexity: 'moderate',
        labels: [],
        prompt_hash: 'hash-1',
        created_at: '2026-04-16T00:00:00Z',
      }),
    });

    const client = new BenchmarkClient({ baseUrl: 'https://kfdb.example', apiKey: 'secret' });
    await client.createTask({
      source_repo: 'owner/repo',
      issue_number: 42,
      issue_title: 'Fix bug',
      sanitized_prompt: 'Fix it',
      campaign_id: 'camp-1',
      prompt_hash: 'hash-1',
      task_manifest_id: 'manifest-1',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toMatchObject({
      campaign_id: 'camp-1',
      prompt_hash: 'hash-1',
      task_manifest_id: 'manifest-1',
    });
  });

  it('passes campaign filters when searching runs', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    });

    const client = new BenchmarkClient({ baseUrl: 'https://kfdb.example/', apiKey: 'secret' });
    await client.searchRuns({ campaign_id: 'camp-2', limit: 25 });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://kfdb.example/api/v1/benchmark/runs?campaign_id=camp-2&limit=25',
    );
  });

  it('publishes a benchmark campaign', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        campaign_id: 'camp-3',
        tasks_published: 4,
        runs_published: 16,
        report_id: 'report-1',
      }),
    });

    const client = new BenchmarkClient({ baseUrl: 'https://kfdb.example', apiKey: 'secret' });
    const result = await client.publishCampaign({
      campaign_id: 'camp-3',
      title: 'Lean verification campaign',
      methodology_refs: ['method://1'],
      provenance_refs: ['prov://1'],
      release_ready: true,
    });

    expect(result.runs_published).toBe(16);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kfdb.example/api/v1/benchmark/campaigns/publish');
    expect(JSON.parse(init.body as string)).toMatchObject({
      campaign_id: 'camp-3',
      title: 'Lean verification campaign',
      release_ready: true,
    });
  });
});
