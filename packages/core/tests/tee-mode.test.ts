import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPGateway } from '../src/client.js';

const BASE = 'http://localhost:8080';
const TEE_URL = 'https://tee.knowledgedataflow.org';

describe('TEE Private Mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults teeMode to false with only API key (no wallet)', () => {
    const gw = new MCPGateway({ url: BASE });
    expect(gw.teeMode).toBe(false);
  });

  it('defaults teeMode to true when spendingWallet is configured', () => {
    // Create a minimal mock SpendingWallet
    const mockWallet = { sign: vi.fn() } as any;
    const gw = new MCPGateway({ url: BASE, spendingWallet: mockWallet });
    expect(gw.teeMode).toBe(true);
  });

  it('defaults teeMode to true when wallet.privateKey is configured', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gw = new MCPGateway({
      url: BASE,
      wallet: { privateKey: '0x' + '1'.repeat(64) },
    });
    expect(gw.teeMode).toBe(true);
    warnSpy.mockRestore();
  });

  it('respects explicit teeMode: false even with wallet auth', () => {
    const gw = new MCPGateway({
      url: BASE,
      teeMode: false,
      wallet: { privateKey: '0x' + '1'.repeat(64) },
    });
    expect(gw.teeMode).toBe(false);
  });

  it('respects explicit teeMode: true even without wallet auth', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gw = new MCPGateway({ url: BASE, teeMode: true });
    expect(gw.teeMode).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('teeMode is enabled without wallet auth'),
    );
    warnSpy.mockRestore();
  });

  it('uses TEE URL when teeMode is true', async () => {
    vi.spyOn(globalThis, 'fetch')
      // Auth call goes to TEE URL (authenticate() is direct, not through authenticatedFetch)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt', expiresAt: '2099-01-01' }),
      } as Response)
      // Auto-attestation fires on first authenticatedFetch call
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: true,
          platform: 'gcp-confidential-space',
          encryption_enabled: true,
        }),
      } as Response)
      // listServers call goes to TEE URL
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ servers: [{ id: '1', name: 'tee-server' }] }),
      } as Response);

    const gw = new MCPGateway({
      url: BASE,
      teeMode: true,
      wallet: { privateKey: '0x' + '1'.repeat(64) },
    });
    expect(gw.teeMode).toBe(true);

    await gw.authenticate();
    const servers = await gw.listServers();
    expect(servers).toHaveLength(1);

    // Verify auth and listServers went to TEE URL (skip attestation call at index 1)
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain(TEE_URL);
    expect(calls[2][0]).toContain(TEE_URL);
    expect(calls[0][0]).not.toContain('localhost');
    expect(calls[2][0]).not.toContain('localhost');
  });

  it('uses custom teeBaseUrl when provided', async () => {
    const customTeeUrl = 'https://custom-tee.example.com';
    vi.spyOn(globalThis, 'fetch')
      // Auth
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt', expiresAt: '2099-01-01' }),
      } as Response)
      // Auto-attestation
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: true,
          platform: 'gcp-confidential-space',
          encryption_enabled: true,
        }),
      } as Response)
      // listServers
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ servers: [] }),
      } as Response);

    const gw = new MCPGateway({
      url: BASE,
      teeMode: true,
      teeBaseUrl: customTeeUrl,
      wallet: { privateKey: '0x' + '1'.repeat(64) },
    });

    await gw.authenticate();
    await gw.listServers();

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    // Auth call goes to custom TEE URL
    expect(calls[0][0]).toContain(customTeeUrl);
    // Attestation also goes to custom TEE URL
    expect(calls[1][0]).toContain(customTeeUrl);
  });

  it('warns when teeMode enabled without wallet auth', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new MCPGateway({ url: BASE, teeMode: true });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('teeMode is enabled without wallet auth'),
    );
  });

  it('does not warn when teeMode enabled with wallet auth', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new MCPGateway({
      url: BASE,
      teeMode: true,
      wallet: { privateKey: '0x' + '1'.repeat(64) },
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe('verifyAttestation', () => {
    it('returns attestation result on success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: true,
          platform: 'gcp-confidential-space',
          image_digest: 'sha256:abc123',
          encryption_enabled: true,
        }),
      } as Response);

      const gw = new MCPGateway({ url: BASE });
      const result = await gw.verifyAttestation();

      expect(result.verified).toBe(true);
      expect(result.platform).toBe('gcp-confidential-space');
      expect(result.imageDigest).toBe('sha256:abc123');
      expect(result.encryptionEnabled).toBe(true);

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${TEE_URL}/api/v1/attestation`);
    });

    it('throws on attestation endpoint failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const gw = new MCPGateway({ url: BASE });
      await expect(gw.verifyAttestation()).rejects.toThrow('TEE attestation request failed: 503');
    });

    it('returns verified=false when attestation_available is false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: false,
          platform: 'none',
          encryption_enabled: false,
        }),
      } as Response);

      const gw = new MCPGateway({ url: BASE });
      const result = await gw.verifyAttestation();
      expect(result.verified).toBe(false);
    });

    it('uses custom teeBaseUrl for attestation', async () => {
      const customTeeUrl = 'https://my-tee.example.com';
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: true,
          platform: 'custom',
          encryption_enabled: true,
        }),
      } as Response);

      const gw = new MCPGateway({ url: BASE, teeBaseUrl: customTeeUrl });
      await gw.verifyAttestation();

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe(`${customTeeUrl}/api/v1/attestation`);
    });
  });

  describe('enablePrivateMode', () => {
    it('switches to TEE mode after successful attestation', async () => {
      vi.spyOn(globalThis, 'fetch')
        // verifyAttestation
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            attestation_available: true,
            platform: 'gcp-confidential-space',
            image_digest: 'sha256:abc123',
            encryption_enabled: true,
          }),
        } as Response)
        // listServers (after switching to TEE)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ servers: [{ id: '1' }] }),
        } as Response);

      // Explicitly disable teeMode to test enablePrivateMode toggle
      const gw = new MCPGateway({
        url: BASE,
        teeMode: false,
        wallet: { privateKey: '0x' + '1'.repeat(64) },
      });

      expect(gw.teeMode).toBe(false);

      const attestation = await gw.enablePrivateMode();
      expect(attestation.verified).toBe(true);
      expect(gw.teeMode).toBe(true);

      // Subsequent calls should go to TEE URL
      await gw.listServers();
      const serverCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(serverCall[0]).toContain(TEE_URL);
    });

    it('throws when attestation fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: false,
          platform: 'none',
          encryption_enabled: false,
        }),
      } as Response);

      // Explicitly disable teeMode to test enablePrivateMode failure path
      const gw = new MCPGateway({
        url: BASE,
        teeMode: false,
        wallet: { privateKey: '0x' + '1'.repeat(64) },
      });

      await expect(gw.enablePrivateMode()).rejects.toThrow('TEE attestation failed');
      expect(gw.teeMode).toBe(false);
    });

    it('throws when no wallet auth is configured', async () => {
      const gw = new MCPGateway({ url: BASE });

      await expect(gw.enablePrivateMode()).rejects.toThrow(
        'TEE private mode requires wallet auth',
      );
    });
  });

  describe('auto-attestation', () => {
    it('verifies attestation on first authenticatedFetch call when teeMode is active', async () => {
      vi.spyOn(globalThis, 'fetch')
        // authenticate() is direct (not through authenticatedFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt', expiresAt: '2099-01-01' }),
        } as Response)
        // Auto-attestation fires on first authenticatedFetch (listServers)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            attestation_available: true,
            platform: 'gcp-confidential-space',
            image_digest: 'sha256:abc123',
            encryption_enabled: true,
          }),
        } as Response)
        // listServers call
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ servers: [{ id: '1' }] }),
        } as Response);

      const gw = new MCPGateway({
        url: BASE,
        teeMode: true,
        wallet: { privateKey: '0x' + '1'.repeat(64) },
      });

      await gw.authenticate();
      await gw.listServers();

      // Order: auth, attestation, listServers
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[1][0]).toBe(`${TEE_URL}/api/v1/attestation`);
      expect(calls).toHaveLength(3);
    });

    it('caches attestation after first success (does not re-verify)', async () => {
      vi.spyOn(globalThis, 'fetch')
        // Auth
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt', expiresAt: '2099-01-01' }),
        } as Response)
        // Auto-attestation (only once, on first authenticatedFetch)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            attestation_available: true,
            platform: 'gcp-confidential-space',
            encryption_enabled: true,
          }),
        } as Response)
        // listServers (first)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ servers: [] }),
        } as Response)
        // listServers (second — no attestation needed)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ servers: [] }),
        } as Response);

      const gw = new MCPGateway({
        url: BASE,
        teeMode: true,
        wallet: { privateKey: '0x' + '1'.repeat(64) },
      });

      await gw.authenticate();
      await gw.listServers();
      await gw.listServers();

      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      const attestationCalls = calls.filter(c => String(c[0]).includes('/api/v1/attestation'));
      expect(attestationCalls).toHaveLength(1);
      expect(calls).toHaveLength(4);
    });

    it('throws on first authenticatedFetch when attestation fails', async () => {
      vi.spyOn(globalThis, 'fetch')
        // Auto-attestation fails
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            attestation_available: false,
            platform: 'none',
            encryption_enabled: false,
          }),
        } as Response);

      const gw = new MCPGateway({
        url: BASE,
        teeMode: true,
        wallet: { privateKey: '0x' + '1'.repeat(64) },
      });

      // listServers uses authenticatedFetch, which triggers auto-attestation
      await expect(gw.listServers()).rejects.toThrow(
        'TEE attestation failed',
      );
    });

    it('does not verify attestation when teeMode is false', async () => {
      vi.spyOn(globalThis, 'fetch')
        // Auth
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt', expiresAt: '2099-01-01' }),
        } as Response)
        // listServers
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ servers: [] }),
        } as Response);

      const gw = new MCPGateway({ url: BASE });

      await gw.authenticate();
      await gw.listServers();

      // No attestation call — just auth + listServers
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      const attestationCalls = calls.filter(c => String(c[0]).includes('/api/v1/attestation'));
      expect(attestationCalls).toHaveLength(0);
      expect(calls).toHaveLength(2);
    });

    it('skips auto-attestation after enablePrivateMode (already verified)', async () => {
      vi.spyOn(globalThis, 'fetch')
        // enablePrivateMode attestation
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            attestation_available: true,
            platform: 'gcp-confidential-space',
            encryption_enabled: true,
          }),
        } as Response)
        // listServers
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ servers: [] }),
        } as Response);

      const gw = new MCPGateway({
        url: BASE,
        teeMode: false,
        wallet: { privateKey: '0x' + '1'.repeat(64) },
      });

      await gw.enablePrivateMode();
      await gw.listServers();

      // Only 1 attestation call (from enablePrivateMode), not 2
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      const attestationCalls = calls.filter(c => String(c[0]).includes('/api/v1/attestation'));
      expect(attestationCalls).toHaveLength(1);
    });
  });
});
