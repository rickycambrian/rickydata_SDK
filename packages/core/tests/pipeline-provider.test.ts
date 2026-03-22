import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineClient } from '../src/pipeline/pipeline-client.js';
import { MINIMAX_MODEL } from '../src/pipeline/types.js';

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

describe('PipelineClient provider resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── _resolveProvider() unit tests ────────────────────────────────────────

  describe('_resolveProvider()', () => {
    const client = mockClient();

    it('returns explicit provider when given', () => {
      expect(client._resolveProvider('claude')).toBe('claude');
      expect(client._resolveProvider('minimax')).toBe('minimax');
    });

    it('auto-detects minimax from model prefix', () => {
      expect(client._resolveProvider(undefined, 'MiniMax-M2.7')).toBe('minimax');
      expect(client._resolveProvider(undefined, 'MiniMax-future')).toBe('minimax');
    });

    it('defaults to minimax when neither provider nor model given', () => {
      expect(client._resolveProvider(undefined, undefined)).toBe('minimax');
    });

    it('explicit provider wins over model prefix', () => {
      expect(client._resolveProvider('claude', 'MiniMax-M2.7')).toBe('claude');
    });

    it('defaults to minimax for non-MiniMax model without explicit provider', () => {
      expect(client._resolveProvider(undefined, 'claude-sonnet')).toBe('minimax');
    });
  });

  // ── resolve() provider flow ──────────────────────────────────────────────

  describe('resolve() provider in request body', () => {
    it('includes provider=minimax by default', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'r1', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 1);

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options.provider).toBe('minimax');
    });

    it('auto-detects minimax from MiniMax model', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'r2', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 1, { model: MINIMAX_MODEL });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options.provider).toBe('minimax');
      expect(sentBody.options.model).toBe('MiniMax-M2.7');
    });

    it('passes explicit claude provider', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'r3', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 1, { provider: 'claude', model: 'claude-sonnet' });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options.provider).toBe('claude');
    });

    it('preserves other options alongside provider', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'r4', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 5, {
        model: MINIMAX_MODEL,
        budget_usd: 1.0,
        timeout_seconds: 300,
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options).toEqual({
        model: 'MiniMax-M2.7',
        budget_usd: 1.0,
        timeout_seconds: 300,
        provider: 'minimax',
      });
    });
  });

  // ── MINIMAX_MODEL constant ───────────────────────────────────────────────

  it('MINIMAX_MODEL equals MiniMax-M2.7', () => {
    expect(MINIMAX_MODEL).toBe('MiniMax-M2.7');
  });
});
