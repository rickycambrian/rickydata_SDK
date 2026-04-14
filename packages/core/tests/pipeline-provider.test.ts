import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineClient } from '../src/pipeline/pipeline-client.js';
import { GLM_MODEL, MINIMAX_MODEL } from '../src/pipeline/types.js';

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
      expect(client._resolveProvider('openrouter')).toBe('openrouter');
      expect(client._resolveProvider('openclaude')).toBe('openclaude');
    });

    it('auto-detects minimax from model prefix', () => {
      expect(client._resolveProvider(undefined, 'MiniMax-M2.7')).toBe('minimax');
      expect(client._resolveProvider(undefined, 'MiniMax-future')).toBe('minimax');
    });

    it('defaults to minimax when neither provider nor model given', () => {
      expect(client._resolveProvider(undefined, undefined)).toBe('minimax');
    });

    it('auto-detects zai from glm model prefix', () => {
      expect(client._resolveProvider(undefined, GLM_MODEL)).toBe('zai');
      expect(client._resolveProvider(undefined, 'glm-4.5')).toBe('zai');
      expect(client._resolveProvider(undefined, 'glm-5.1-thinking')).toBe('zai');
    });

    it('explicit provider wins over model prefix', () => {
      expect(client._resolveProvider('claude', 'MiniMax-M2.7')).toBe('claude');
    });

    it('auto-detects claude for claude-family aliases', () => {
      expect(client._resolveProvider(undefined, 'claude-sonnet-4-6')).toBe('claude');
      expect(client._resolveProvider(undefined, 'claude-sonnet')).toBe('claude');
      expect(client._resolveProvider(undefined, 'sonnet')).toBe('claude');
      expect(client._resolveProvider(undefined, 'haiku')).toBe('claude');
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

    it('auto-detects zai from GLM model', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'r3b', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 1, { model: GLM_MODEL });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options.provider).toBe('zai');
      expect(sentBody.options.model).toBe(GLM_MODEL);
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

    it('passes through executionEngine alongside inferred provider', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        okResponse({ run_id: 'r5', accepted: true }),
      );

      const client = mockClient();
      await client.resolve('owner/repo', 9, {
        model: GLM_MODEL,
        executionEngine: 'openclaude',
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.options).toEqual({
        model: 'glm-5.1',
        executionEngine: 'openclaude',
        provider: 'zai',
      });
    });
  });

  // ── MINIMAX_MODEL constant ───────────────────────────────────────────────

  it('MINIMAX_MODEL equals MiniMax-M2.7', () => {
    expect(MINIMAX_MODEL).toBe('MiniMax-M2.7');
  });

  it('GLM_MODEL equals glm-5.1', () => {
    expect(GLM_MODEL).toBe('glm-5.1');
  });
});
