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

  it('passes benchmark proof and trace fields when recording runs', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        run_id: 'run-1',
        tenant_id: 'tenant-1',
        task_id: 'task-1',
        provider: 'claude-code',
        model: 'claude-opus-4.6',
        thinking_mode: 'enabled',
        context_strategy: 'dynamic-docs',
        duration_seconds: 120,
        success: true,
        proof_verified: true,
        created_at: '2026-04-26T00:00:00Z',
      }),
    });

    const client = new BenchmarkClient({ baseUrl: 'https://kfdb.example', apiKey: 'secret' });
    await client.recordRun({
      task_id: 'task-1',
      provider: 'claude-code',
      model: 'claude-opus-4.6',
      trace_ref: 'trace://run-1',
      trace_artifact_hash: 'a'.repeat(64),
      trace_kg_ref: 'kfdb://trace-kg/run-1',
      trace_kg_summary: { tool_call_count: 12 },
      proof_manifest_hash: 'b'.repeat(64),
      proof_bundle: { version: 'rickydata-benchmark-run-proof/v1' },
      proof_verified: true,
      proof_verification_status: 'verified',
      attestation_code_hash: 'c'.repeat(64),
      attestation_image_digest: 'sha256:image',
      attestation_verdict: 'report_data_bound_ed25519_verified',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://kfdb.example/api/v1/benchmark/runs');
    expect(JSON.parse(init.body as string)).toMatchObject({
      trace_ref: 'trace://run-1',
      trace_artifact_hash: 'a'.repeat(64),
      trace_kg_ref: 'kfdb://trace-kg/run-1',
      trace_kg_summary: { tool_call_count: 12 },
      proof_manifest_hash: 'b'.repeat(64),
      proof_bundle: { version: 'rickydata-benchmark-run-proof/v1' },
      proof_verified: true,
      proof_verification_status: 'verified',
      attestation_code_hash: 'c'.repeat(64),
      attestation_image_digest: 'sha256:image',
      attestation_verdict: 'report_data_bound_ed25519_verified',
    });
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
