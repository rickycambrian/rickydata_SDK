import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineClient } from '../src/pipeline/pipeline-client.js';

const BASE = 'https://agents.rickydata.org';
const API_KEY = 'test-key-123';

function mockClient() {
  return new PipelineClient({ baseUrl: BASE, apiKey: API_KEY });
}

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
  } as Response;
}

describe('PipelineClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  it('strips trailing slash from baseUrl', () => {
    const client = new PipelineClient({ baseUrl: BASE + '/', apiKey: API_KEY });
    expect(client).toBeDefined();
  });

  // ── resolve() ────────────────────────────────────────────────────────────

  describe('resolve()', () => {
    it('sends correct request body and returns response', async () => {
      const responseBody = {
        run_id: 'run-1',
        repo: 'owner/repo',
        issue_number: 42,
        accepted: true,
        routing: {
          model: 'claude-haiku',
          expected_success_rate: 0.85,
          expected_cost_usd: 0.009,
          roi: 40.6,
          reasoning: 'simple issue',
        },
        status: 'queued',
        created_at: '2026-03-15T00:00:00Z',
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse(responseBody));

      const client = mockClient();
      const result = await client.resolve('owner/repo', 42, { mode: 'local', budget_usd: 0.5 });

      expect(result).toEqual(responseBody);

      // Verify URL
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${BASE}/api/v1/pipeline/resolve`);

      // Verify headers
      expect(init?.headers).toMatchObject({
        'X-KF-API-Key': API_KEY,
        'Content-Type': 'application/json',
      });

      // Verify request body
      const sentBody = JSON.parse(init?.body as string);
      expect(sentBody).toEqual({
        repo: 'owner/repo',
        issue_number: 42,
        options: { mode: 'local', budget_usd: 0.5 },
      });
    });

    it('sends request without options when not provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'run-2', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 1);

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options).toBeUndefined();
    });

    it('throws when repo is empty', async () => {
      const client = mockClient();
      await expect(client.resolve('', 1)).rejects.toThrow('repo is required');
    });

    it('throws when issueNumber is 0', async () => {
      const client = mockClient();
      await expect(client.resolve('owner/repo', 0)).rejects.toThrow('issueNumber must be a positive integer');
    });

    it('throws when issueNumber is negative', async () => {
      const client = mockClient();
      await expect(client.resolve('owner/repo', -1)).rejects.toThrow('issueNumber must be a positive integer');
    });

    it('throws on non-ok response with error body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(422, 'Validation failed'));

      const client = mockClient();
      await expect(client.resolve('owner/repo', 1)).rejects.toThrow(
        'Failed to submit issue for resolution: 422 Validation failed',
      );
    });

    it('throws on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fetch failed'));

      const client = mockClient();
      await expect(client.resolve('owner/repo', 1)).rejects.toThrow('fetch failed');
    });
  });

  // ── getStatus() ──────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('sends GET request and returns status', async () => {
      const statusBody = {
        healthy: true,
        checked_at: '2026-03-15T00:00:00Z',
        active_runs: 3,
        total_runs: 150,
        success_rate: 0.82,
        roi_data: { loaded: true, last_updated: '2026-03-14T00:00:00Z', repos_count: 12, configs_count: 4 },
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse(statusBody));

      const client = mockClient();
      const result = await client.getStatus();

      expect(result).toEqual(statusBody);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${BASE}/api/v1/pipeline/status`);
      expect(init?.headers).toMatchObject({ 'X-KF-API-Key': API_KEY });
      // Should be GET (no method override = default GET)
      expect(init?.method).toBeUndefined();
    });

    it('throws on server error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'));

      const client = mockClient();
      await expect(client.getStatus()).rejects.toThrow(
        'Failed to get pipeline status: 500 Internal Server Error',
      );
    });

    it('throws on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('DNS resolution failed'));

      const client = mockClient();
      await expect(client.getStatus()).rejects.toThrow('DNS resolution failed');
    });
  });

  // ── reportOutcome() ──────────────────────────────────────────────────────

  describe('reportOutcome()', () => {
    it('sends outcome report and returns response', async () => {
      const outcomeResponse = {
        recorded: true,
        updated_roi: {
          config_name: 'claude-haiku',
          new_success_rate: 0.86,
          new_avg_cost: 0.0095,
          new_avg_quality: 0.78,
          sample_size: 51,
        },
        message: 'Outcome recorded',
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse(outcomeResponse));

      const client = mockClient();
      const result = await client.reportOutcome({
        run_id: 'run-1',
        outcome: 'merged',
        actual_cost_usd: 0.012,
        actual_quality_score: 0.9,
        duration_seconds: 45,
        notes: 'Clean merge',
      });

      expect(result).toEqual(outcomeResponse);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${BASE}/api/feedback/outcome`);
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        'X-KF-API-Key': API_KEY,
        'Content-Type': 'application/json',
      });

      const sentBody = JSON.parse(init?.body as string);
      expect(sentBody).toEqual({
        run_id: 'run-1',
        outcome: 'merged',
        actual_cost_usd: 0.012,
        actual_quality_score: 0.9,
        duration_seconds: 45,
        notes: 'Clean merge',
      });
    });

    it('throws when run_id is empty', async () => {
      const client = mockClient();
      await expect(
        client.reportOutcome({ run_id: '', outcome: 'merged' }),
      ).rejects.toThrow('run_id is required');
    });

    it('throws when outcome is empty', async () => {
      const client = mockClient();
      await expect(
        client.reportOutcome({ run_id: 'run-1', outcome: '' as any }),
      ).rejects.toThrow('outcome type is required');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(errorResponse(404, 'Run not found'));

      const client = mockClient();
      await expect(
        client.reportOutcome({ run_id: 'run-999', outcome: 'merged' }),
      ).rejects.toThrow('Failed to report pipeline outcome: 404 Run not found');
    });

    it('handles error response where text() fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.reject(new Error('body stream already consumed')),
      } as unknown as Response);

      const client = mockClient();
      await expect(
        client.reportOutcome({ run_id: 'run-1', outcome: 'error' }),
      ).rejects.toThrow('Failed to report pipeline outcome: 503');
    });
  });
});
