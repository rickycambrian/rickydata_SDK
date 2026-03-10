import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthManager, createWalletToken } from '../src/auth.js';

const BASE = 'http://localhost:8080';

describe('AuthManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (AuthManager as any).warnedLegacyWalletOnlyAuth = false;
  });

  it('is not authenticated initially', () => {
    const auth = new AuthManager(BASE);
    expect(auth.isAuthenticated).toBe(false);
    expect(() => auth.getToken()).toThrow('Not authenticated');
  });

  it('is authenticated when created with a token', () => {
    const auth = new AuthManager(BASE, 'existing-token');
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.getToken()).toBe('existing-token');
  });

  it('returns auth headers when authenticated', () => {
    const auth = new AuthManager(BASE, 'my-token');
    expect(auth.getAuthHeaders()).toEqual({ Authorization: 'Bearer my-token' });
  });

  it('returns empty headers when not authenticated', () => {
    const auth = new AuthManager(BASE);
    expect(auth.getAuthHeaders()).toEqual({});
  });

  it('authenticates in test mode', async () => {
    const mockRes = { ok: true, json: () => Promise.resolve({ token: 'test-jwt', expiresAt: '2099-01-01' }) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockRes as Response);

    const auth = new AuthManager(BASE);
    const session = await auth.authenticate();

    expect(session.token).toBe('test-jwt');
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.getToken()).toBe('test-jwt');
  });

  it('authenticates with wallet signature', async () => {
    // Mock challenge — returns nonce + message (matches real gateway)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ nonce: 'abc123', message: 'Sign this message...' }),
      } as Response)
      // Mock verify
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'signed-jwt' }),
      } as Response);

    const signFn = vi.fn().mockResolvedValue('0xsignature');
    const auth = new AuthManager(BASE);
    const session = await auth.authenticate(signFn, '0xAddress');

    // Should sign the message, not the nonce
    expect(signFn).toHaveBeenCalledWith('Sign this message...');
    expect(session.token).toBe('signed-jwt');
    expect(session.address).toBe('0xAddress');

    // Verify the verify request includes walletAddress and nonce
    const verifyCall = vi.mocked(fetch).mock.calls[1];
    const verifyBody = JSON.parse(verifyCall[1]?.body as string);
    expect(verifyBody.walletAddress).toBe('0xAddress');
    expect(verifyBody.nonce).toBe('abc123');
    expect(verifyBody.signature).toBe('0xsignature');
  });

  it('sends walletAddress in test mode', async () => {
    const mockRes = { ok: true, json: () => Promise.resolve({ token: 'test-jwt', expiresAt: '2099-01-01' }) };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockRes as Response);

    const auth = new AuthManager(BASE);
    await auth.authenticate(undefined, '0xMyWallet');

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body.walletAddress).toBe('0xMyWallet');
    expect(body.testMode).toBe(true);
    expect(body.address).toBeUndefined(); // should NOT use "address"
  });

  it('warns once for legacy wallet-only authenticate(...) usage', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'test-jwt', expiresAt: '2099-01-01' }),
    } as Response);

    const auth = new AuthManager(BASE);
    await auth.authenticate(undefined, '0xMyWallet');
    await auth.authenticate(undefined, '0xMyWallet');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('authenticate(undefined, walletAddress) uses test mode');
  });

  it('authenticates with ERC-8128 signer mode and signs requests', async () => {
    const signer = {
      address: '0x0000000000000000000000000000000000000001' as const,
      chainId: 8453,
      signMessage: vi.fn().mockResolvedValue('0x1234' as const),
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve('{\"ok\":true}'),
    } as Response);

    const auth = new AuthManager(BASE);
    await auth.authenticateWithErc8128(signer);

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.getAuthHeaders()).toEqual({});

    await auth.erc8128Fetch(`${BASE}/api/servers`);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [requestLike, init] = vi.mocked(fetch).mock.calls[0];
    const headers = requestLike instanceof Request
      ? requestLike.headers
      : new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('signature')).toBeTruthy();
    expect(headers.get('signature-input')).toBeTruthy();
  });

  it('authenticateAuto selects ERC-8128 for operator strict path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const signer = {
      address: '0x0000000000000000000000000000000000000001' as const,
      chainId: 8453,
      signMessage: vi.fn().mockResolvedValue('0x1234' as const),
    };
    const auth = new AuthManager(BASE);

    const res = await auth.authenticateAuto({
      erc8128Signer: signer,
      walletAddress: signer.address,
      operatorWalletAddress: signer.address,
    });

    expect(res).toBeNull();
    expect(auth.isErc8128Mode()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('authenticateAuto prefers wallet-token for user path', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'MCP Gateway Auth\\nWallet: 0xAbc\\nExpires: 2027-01-01T00:00:00Z' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          token: 'mcpwt_auto',
          walletAddress: '0xAbc',
          expiresAt: '2027-01-01T00:00:00Z',
        }),
      } as Response);

    const signFn = vi.fn().mockResolvedValue('0xsig');
    const auth = new AuthManager(BASE);
    const session = await auth.authenticateAuto({
      signFn,
      walletAddress: '0xAbc',
      walletTokenExpiresAt: '2027-01-01T00:00:00Z',
    });

    expect(session?.token).toBe('mcpwt_auto');
    expect(auth.getToken()).toBe('mcpwt_auto');
  });

  it('authenticateAuto falls back to signature auth when wallet-token endpoint is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch')
      // Wallet-token attempt fails
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('token message unavailable'),
      } as Response)
      // Signature fallback challenge
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ nonce: 'n1', message: 'Sign this fallback challenge' }),
      } as Response)
      // Signature fallback verify
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'signed-fallback-jwt', expiresAt: '2099-01-01' }),
      } as Response);

    const signFn = vi.fn().mockResolvedValue('0xsig');
    const auth = new AuthManager(BASE);
    const session = await auth.authenticateAuto({
      signFn,
      walletAddress: '0xAbc',
    });

    expect(session?.token).toBe('signed-fallback-jwt');
    expect(signFn).toHaveBeenCalledWith('Sign this fallback challenge');
    expect(auth.getToken()).toBe('signed-fallback-jwt');
  });

  it('authenticateAuto does not downgrade to signature auth for non-availability wallet-token errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('internal error'),
      } as Response);

    const signFn = vi.fn().mockResolvedValue('0xsig');
    const auth = new AuthManager(BASE);

    await expect(
      auth.authenticateAuto({
        signFn,
        walletAddress: '0xAbc',
      }),
    ).rejects.toThrow('Failed to get token message: 500');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on auth failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as Response);

    const auth = new AuthManager(BASE);
    await expect(auth.authenticate()).rejects.toThrow('Auth failed: 401');
  });

  describe('re-authentication', () => {
    it('canReauthenticate is false before authenticate()', () => {
      const auth = new AuthManager(BASE);
      expect(auth.canReauthenticate).toBe(false);
    });

    it('canReauthenticate is true after authenticate() (test mode)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt-1', expiresAt: Date.now() + 86400000 }),
      } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate();
      expect(auth.canReauthenticate).toBe(true);
    });

    it('reauthenticate() throws without prior authenticate()', async () => {
      const auth = new AuthManager(BASE);
      await expect(auth.reauthenticate()).rejects.toThrow('no previous credentials');
    });

    it('reauthenticate() gets fresh token (test mode)', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-1', expiresAt: Date.now() + 86400000 }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-2', expiresAt: Date.now() + 86400000 }),
        } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate(undefined, '0xWallet');
      expect(auth.getToken()).toBe('jwt-1');

      await auth.reauthenticate();
      expect(auth.getToken()).toBe('jwt-2');
    });

    it('reauthenticate() gets fresh token (signature mode)', async () => {
      const signFn = vi.fn().mockResolvedValue('0xsig');
      vi.spyOn(globalThis, 'fetch')
        // authenticate: challenge + verify
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: 'n1', message: 'msg1' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-1' }),
        } as Response)
        // reauthenticate: challenge + verify
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: 'n2', message: 'msg2' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-2' }),
        } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate(signFn, '0xAddr');
      expect(auth.getToken()).toBe('jwt-1');

      await auth.reauthenticate();
      expect(auth.getToken()).toBe('jwt-2');
      expect(signFn).toHaveBeenCalledTimes(2);
    });

    it('isExpired is true when token expiry has passed', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt-1', expiresAt: Date.now() - 1000 }),
      } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate();
      expect(auth.isExpired).toBe(true);
    });

    it('isExpired is false when token is still valid', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt-1', expiresAt: Date.now() + 86400000 }),
      } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate();
      expect(auth.isExpired).toBe(false);
    });

    it('isExpired parses string dates', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt-1', expiresAt: '2020-01-01T00:00:00Z' }),
      } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate();
      expect(auth.isExpired).toBe(true);
    });

    it('deduplicates concurrent reauthenticate() calls', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-1' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-fresh' }),
        } as Response);

      const auth = new AuthManager(BASE);
      await auth.authenticate();

      // Call reauthenticate concurrently — should only trigger one fetch
      const [r1, r2] = await Promise.all([
        auth.reauthenticate(),
        auth.reauthenticate(),
      ]);
      expect(r1.token).toBe('jwt-fresh');
      expect(r2.token).toBe('jwt-fresh');
      // authenticate (1 fetch) + reauthenticate (1 fetch) = 2 total
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('wallet token auth', () => {
    function mockWalletTokenFlow() {
      return vi.spyOn(globalThis, 'fetch')
        // GET /api/auth/token-message
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'MCP Gateway Auth\nWallet: 0xAbc\nExpires: 2027-01-01T00:00:00Z' }),
        } as Response)
        // POST /api/auth/create-token
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            token: 'mcpwt_test123',
            walletAddress: '0xAbc',
            expiresAt: '2027-01-01T00:00:00Z',
          }),
        } as Response);
    }

    it('authenticateWithWalletToken stores token', async () => {
      mockWalletTokenFlow();
      const signFn = vi.fn().mockResolvedValue('0xsig');
      const auth = new AuthManager(BASE);

      const session = await auth.authenticateWithWalletToken(signFn, '0xAbc', '2027-01-01T00:00:00Z');

      expect(session.token).toBe('mcpwt_test123');
      expect(session.address).toBe('0xAbc');
      expect(auth.isAuthenticated).toBe(true);
      expect(auth.getToken()).toBe('mcpwt_test123');
      expect(signFn).toHaveBeenCalledWith('MCP Gateway Auth\nWallet: 0xAbc\nExpires: 2027-01-01T00:00:00Z');
    });

    it('authenticateWithWalletToken sets canReauthenticate', async () => {
      mockWalletTokenFlow();
      const signFn = vi.fn().mockResolvedValue('0xsig');
      const auth = new AuthManager(BASE);

      await auth.authenticateWithWalletToken(signFn, '0xAbc', '2027-01-01T00:00:00Z');
      expect(auth.canReauthenticate).toBe(true);
    });

    it('reauthenticate works for wallet token mode', async () => {
      // Initial auth
      mockWalletTokenFlow();
      const signFn = vi.fn().mockResolvedValue('0xsig');
      const auth = new AuthManager(BASE);

      await auth.authenticateWithWalletToken(signFn, '0xAbc', '2027-01-01T00:00:00Z');
      expect(auth.getToken()).toBe('mcpwt_test123');

      // Re-auth: mock a second wallet token flow
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'MCP Gateway Auth\nWallet: 0xAbc\nExpires: 2027-01-01T00:00:00Z' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            token: 'mcpwt_refreshed456',
            walletAddress: '0xAbc',
            expiresAt: '2027-01-01T00:00:00Z',
          }),
        } as Response);

      const session = await auth.reauthenticate();
      expect(session.token).toBe('mcpwt_refreshed456');
      expect(auth.getToken()).toBe('mcpwt_refreshed456');
      expect(signFn).toHaveBeenCalledTimes(2);
    });

    it('wallet token sets expiry correctly', async () => {
      mockWalletTokenFlow();
      const signFn = vi.fn().mockResolvedValue('0xsig');
      const auth = new AuthManager(BASE);

      await auth.authenticateWithWalletToken(signFn, '0xAbc', '2027-01-01T00:00:00Z');
      expect(auth.isExpired).toBe(false); // 2027 is in the future
    });

    it('wallet token auth headers use Bearer prefix', async () => {
      mockWalletTokenFlow();
      const signFn = vi.fn().mockResolvedValue('0xsig');
      const auth = new AuthManager(BASE);

      await auth.authenticateWithWalletToken(signFn, '0xAbc', '2027-01-01T00:00:00Z');
      expect(auth.getAuthHeaders()).toEqual({ Authorization: 'Bearer mcpwt_test123' });
    });
  });

  describe('createWalletToken standalone', () => {
    it('calls token-message and create-token endpoints', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'MCP Gateway Auth\nWallet: 0xDef\nExpires: 2028-06-01T00:00:00Z' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            token: 'mcpwt_standalone',
            walletAddress: '0xDef',
            expiresAt: '2028-06-01T00:00:00Z',
          }),
        } as Response);

      const signFn = vi.fn().mockResolvedValue('0xsig');
      const result = await createWalletToken(BASE, signFn, '0xDef', '2028-06-01T00:00:00Z');

      expect(result.token).toBe('mcpwt_standalone');
      expect(result.walletAddress).toBe('0xDef');

      // Verify correct endpoints called
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls[0][0]).toContain('/api/auth/token-message');
      expect(calls[0][0]).toContain('walletAddress=0xDef');
      expect(calls[1][0]).toBe(`${BASE}/api/auth/create-token`);
    });

    it('throws on token-message failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Invalid wallet'),
      } as Response);

      const signFn = vi.fn();
      await expect(createWalletToken(BASE, signFn, '0xBad', '2028-01-01T00:00:00Z'))
        .rejects.toThrow('Failed to get token message: 400');
    });

    it('throws on create-token failure', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'sign this' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Invalid signature'),
        } as Response);

      const signFn = vi.fn().mockResolvedValue('0xbadsig');
      await expect(createWalletToken(BASE, signFn, '0xAddr', '2028-01-01T00:00:00Z'))
        .rejects.toThrow('Failed to create wallet token: 400');
    });

    it('strips trailing slash from gateway URL', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ message: 'msg' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'mcpwt_x', walletAddress: '0xA', expiresAt: '2028-01-01' }),
        } as Response);

      const signFn = vi.fn().mockResolvedValue('0xsig');
      await createWalletToken(`${BASE}/`, signFn, '0xA', '2028-01-01T00:00:00Z');

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).not.toContain('//api');
    });
  });
});
