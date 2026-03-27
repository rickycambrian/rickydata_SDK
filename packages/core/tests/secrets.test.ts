import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPGateway } from '../src/client.js';
import { VaultError } from '../src/errors/index.js';

const BASE = 'http://localhost:8080';

function mockAuth() {
  return {
    ok: true,
    json: () => Promise.resolve({ token: 'jwt' }),
  } as Response;
}

describe('Vault Secrets', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves all secret values', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          secrets: [
            { key: 'API_ID', value: '12345' },
            { key: 'API_HASH', value: 'abc123' },
          ],
        }),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    const values = await gw.getSecretValues('server-1');

    expect(values).toEqual([
      { key: 'API_ID', value: '12345' },
      { key: 'API_HASH', value: 'abc123' },
    ]);

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[1][0]).toBe(`${BASE}/api/secrets/server-1/values`);
  });

  it('retrieves a single secret value', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ key: 'API_KEY', value: 'sk-test' }),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    const value = await gw.getSecretValue('server-1', 'API_KEY');

    expect(value).toBe('sk-test');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[1][0]).toBe(`${BASE}/api/secrets/server-1/values/API_KEY`);
  });

  it('returns null for missing secret key', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not found'),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    const value = await gw.getSecretValue('server-1', 'MISSING');

    expect(value).toBeNull();
  });

  it('gets comprehensive secret status', async () => {
    const status = {
      serverId: 'server-1',
      configured: ['API_ID'],
      required: ['API_ID', 'API_HASH'],
      optional: ['SESSION_STRING'],
      missing: ['API_HASH'],
      ready: false,
      injectionMode: 'env' as const,
    };

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(status),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    const result = await gw.getSecretStatus('server-1');

    expect(result).toEqual(status);
    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['API_HASH']);
  });

  it('throws VaultError on failed value retrieval', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Access denied'),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();

    await expect(gw.getSecretValues('server-1')).rejects.toThrow(VaultError);
    try {
      await gw.getSecretValues('server-1');
    } catch (e) {
      // The above already threw, need a fresh mock for this assertion
    }
  });

  it('throws VaultError with correct properties', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();

    try {
      await gw.getSecretValues('server-1');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(VaultError);
      const err = e as VaultError;
      expect(err.status).toBe(403);
      expect(err.serverId).toBe('server-1');
      expect(err.message).toContain('403');
    }
  });

  it('throws VaultError on failed status retrieval', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockAuth())
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();

    await expect(gw.getSecretStatus('server-1')).rejects.toThrow(VaultError);
  });
});
