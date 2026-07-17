import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerFromModel } from '../../src/agent/agent-client.js';
import { defaultModelForProvider, resolveModel } from '../../src/cli/commands/chat.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Kimi membership routing', () => {
  it('recognizes both K3 membership model forms', () => {
    expect(providerFromModel('k3')).toBe('kimi');
    expect(providerFromModel('k3[1m]')).toBe('kimi');
  });

  it('uses K3 membership as the Kimi CLI default', () => {
    expect(defaultModelForProvider('kimi')).toBe('k3[1m]');
  });

  it('preserves an explicit free-plan Kimi selection', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plan: 'free',
        modelProvider: 'kimi',
        defaultModel: 'k3[1m]',
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveModel('mcpwt_test', 'https://agents.example.test', undefined))
      .resolves.toBe('k3[1m]');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
