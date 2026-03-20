import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

// Mutable state shared with the vi.mock factory below (hoisted by Vitest)
// Used to simulate readline input for the browser flow tests.
let __mockReadlineAnswer = '';

vi.mock('readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readline')>();
  return {
    ...actual,
    createInterface: vi.fn(() => ({
      question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
        cb(__mockReadlineAnswer);
      }),
      close: vi.fn(),
      output: {
        write: vi.fn(),
      },
    })),
  };
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-auth-test-'));
}

describe('auth commands', () => {
  let tmpDir: string;
  let config: ConfigManager;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = new ConfigManager(path.join(tmpDir, 'config.json'));
    store = new CredentialStore(path.join(tmpDir, 'credentials.json'));
    // Mock fetch to prevent real network calls in CI (auth status checks balance + payment config)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('auth status', () => {
    it('shows not authenticated when no token', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'status']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Not authenticated');
    });

    it('shows authenticated when token exists', async () => {
      store.setToken('mcpwt_test123', '0xabc', 'default');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'status']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Authenticated');
      expect(output).toContain('0xabc');
    });

    it('shows token expiry status', async () => {
      store.setToken('mcpwt_test', '0xabc', 'default', '2030-01-01T00:00:00Z');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'status']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('2030-01-01T00:00:00Z');
    });
  });

  describe('auth logout', () => {
    it('clears stored credentials', async () => {
      store.setToken('mcpwt_test', '0xabc');
      expect(store.hasToken()).toBe(true);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'logout']);

      expect(store.hasToken()).toBe(false);
    });

    it('clears credentials for a specific profile', async () => {
      store.setToken('mcpwt_prod', '0x1', 'prod');
      store.setToken('mcpwt_default', '0x2', 'default');

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'logout', '--profile', 'prod']);

      expect(store.hasToken('prod')).toBe(false);
      expect(store.hasToken('default')).toBe(true);
    });
  });

  describe('auth login --token', () => {
    it('stores a direct mcpwt_ token', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'login', '--token', 'mcpwt_directtoken']);

      const cred = store.getToken('default');
      expect(cred?.token).toBe('mcpwt_directtoken');
    });

    it('rejects token not starting with mcpwt_', async () => {
      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'auth', 'login', '--token', 'invalid_token'])
      ).rejects.toThrow('Token must start with mcpwt_');
    });
  });

  describe('auth login with mocked HTTP', () => {
    it('falls back to challenge/verify when wallet-token endpoint is unavailable', async () => {
      // Mock fetch globally for this test
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'wallet token unavailable',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'testnonce', message: 'Sign this message: testnonce' }),
          text: async () => '',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'jwt_token_abc' }),
          text: async () => '',
        } as Partial<Response>);

      vi.stubGlobal('fetch', mockFetch);

      // Use a real private key for testing (generates deterministic address)
      // Hardhat default account #0 — split to avoid secret guard
      const testPrivateKey = ['0xac0974bec39a17e36ba4a6b4d238ff944b', 'acb478cbed5efcae784d7bf4f2ff80'].join('');

      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--private-key', testPrivateKey,
        '--gateway', 'https://agents.rickydata.org',
      ]);

      // Verify token was stored
      const cred = store.getToken('default');
      expect(cred?.token).toBe('jwt_token_abc');
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify wallet-token endpoint was attempted first
      expect(mockFetch.mock.calls[0][0]).toContain('/api/auth/token-message');

      // Verify challenge fallback endpoints were called
      expect(mockFetch.mock.calls[1][0]).toContain('/auth/challenge');
      expect(mockFetch.mock.calls[2][0]).toContain('/auth/verify');
    });

    it('prefers wallet-token flow when endpoints are available', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Sign this token message' }),
          text: async () => '',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: 'mcpwt_login_token',
            walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
            expiresAt: '2027-01-01T00:00:00Z',
          }),
          text: async () => '',
        } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const testPrivateKey = ['0xac0974bec39a17e36ba4a6b4d238ff944b', 'acb478cbed5efcae784d7bf4f2ff80'].join('');

      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--private-key', testPrivateKey,
        '--gateway', 'https://agents.rickydata.org',
      ]);

      const cred = store.getToken('default');
      expect(cred?.token).toBe('mcpwt_login_token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain('/api/auth/token-message');
      expect(mockFetch.mock.calls[1][0]).toContain('/api/auth/create-token');
    });

    it('uses the selected profile agent gateway URL when --gateway is not provided', async () => {
      config.set('agentGatewayUrl', 'https://profile-agents.example', 'prod');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'not found',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ nonce: 'testnonce', message: 'Sign this message: testnonce' }),
          text: async () => '',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ token: 'jwt_token_profile' }),
          text: async () => '',
        } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const testPrivateKey = ['0xac0974bec39a17e36ba4a6b4d238ff944b', 'acb478cbed5efcae784d7bf4f2ff80'].join('');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--private-key', testPrivateKey,
        '--profile', 'prod',
      ]);

      expect(mockFetch.mock.calls[0][0]).toContain('https://profile-agents.example/api/auth/token-message');
      expect(mockFetch.mock.calls[1][0]).toBe('https://profile-agents.example/auth/challenge');
      expect(mockFetch.mock.calls[2][0]).toBe('https://profile-agents.example/auth/verify');
    });
  });

  describe('auth token create', () => {
    it('uses the selected profile MCP gateway URL when --gateway is not provided', async () => {
      config.set('mcpGatewayUrl', 'https://profile-mcp.example', 'prod');

      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Sign this token message' }),
          text: async () => '',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: 'mcpwt_profile_token',
            walletAddress: '0xabc',
            expiresAt: '2027-01-01T00:00:00Z',
          }),
          text: async () => '',
        } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const testPrivateKey = ['0xac0974bec39a17e36ba4a6b4d238ff944b', 'acb478cbed5efcae784d7bf4f2ff80'].join('');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'token', 'create',
        '--private-key', testPrivateKey,
        '--profile', 'prod',
      ]);

      expect(mockFetch.mock.calls[0][0]).toContain('https://profile-mcp.example/api/auth/token-message');
      expect(mockFetch.mock.calls[1][0]).toBe('https://profile-mcp.example/api/auth/create-token');
      expect(store.getToken('prod')?.token).toBe('mcpwt_profile_token');
    });
  });

  describe('auth login (browser flow — default)', () => {
    // These tests rely on the module-level vi.mock('readline') which intercepts
    // createInterface and returns __mockReadlineAnswer as the user's input.

    it('validates JWT token format and stores it', async () => {
      __mockReadlineAnswer = 'eyJhbGciOiJIUzI1NiJ9.eyJ3YWxsZXRBZGRyZXNzIjoiMHhhYmMiLCJleHAiOjk5OTk5OTk5OTl9.sig';

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'login']);

      const cred = store.getToken('default');
      expect(cred?.token).toBe('eyJhbGciOiJIUzI1NiJ9.eyJ3YWxsZXRBZGRyZXNzIjoiMHhhYmMiLCJleHAiOjk5OTk5OTk5OTl9.sig');
      expect(cred?.walletAddress).toBe('0xabc');
    });

    it('validates mcpwt_ wallet token format and stores it', async () => {
      __mockReadlineAnswer = 'mcpwt_wallettoken123';

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'login']);

      const cred = store.getToken('default');
      expect(cred?.token).toBe('mcpwt_wallettoken123');
      expect(cred?.walletAddress).toBe('(wallet-token)');
    });

    it('rejects invalid token format', async () => {
      __mockReadlineAnswer = 'invalid_not_a_jwt_or_wallet_token';

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'auth', 'login'])
      ).rejects.toThrow('Invalid token format');
    });

    it('decodes JWT payload for wallet address and expiry', async () => {
      // Build a real base64url encoded payload
      const exp = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      const payload = { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', exp };
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const fakeJwt = `eyJhbGciOiJIUzI1NiJ9.${payloadB64}.fakesig`;
      __mockReadlineAnswer = fakeJwt;

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'login']);

      const cred = store.getToken('default');
      expect(cred?.walletAddress).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(cred?.expiresAt).toBe(new Date(exp * 1000).toISOString());
    });

    it('handles browser open failure gracefully and still prompts for token', async () => {
      // open() failure is caught in auth.ts try/catch; flow continues to prompt
      __mockReadlineAnswer = 'mcpwt_fallback_token';

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'auth', 'login']);

      // Should still have stored the token even when browser fails to open
      const cred = store.getToken('default');
      expect(cred?.token).toBe('mcpwt_fallback_token');
    });
  });

  describe('auth login --privy', () => {
    it('exchanges a Privy access token for a JWT', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'jwt_privy_token',
          walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
          expiresAt: Date.now() + 86400000,
          tokenType: 'jwt',
          privyUserId: 'did:privy:user123',
        }),
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--privy', 'privy_access_token_value',
      ]);

      const cred = store.getToken('default');
      expect(cred?.token).toBe('jwt_privy_token');
      expect(cred?.walletAddress).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain('/auth/privy/exchange');

      // Verify the request body includes the access token
      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.privyAccessToken).toBe('privy_access_token_value');
    });

    it('passes --wallet address to the exchange endpoint', async () => {
      const walletAddr = '0x1234567890abcdef1234567890abcdef12345678';
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'jwt_privy_wallet',
          walletAddress: walletAddr,
          expiresAt: Date.now() + 86400000,
          tokenType: 'jwt',
        }),
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--privy', 'privy_token',
        '--wallet', walletAddr,
      ]);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.requestedWalletAddress).toBe(walletAddr);
      expect(store.getToken('default')?.walletAddress).toBe(walletAddr);
    });

    it('throws on exchange failure', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid Privy token', message: 'Token is expired' }),
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const program = createProgram(config, store);
      await expect(
        program.parseAsync([
          'node', 'rickydata', 'auth', 'login',
          '--privy', 'bad_token',
        ])
      ).rejects.toThrow('Token is expired');
    });

    it('uses the profile gateway URL', async () => {
      config.set('agentGatewayUrl', 'https://custom-gateway.example', 'staging');

      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'jwt_staging',
          walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          expiresAt: Date.now() + 86400000,
        }),
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--privy', 'privy_token',
        '--profile', 'staging',
      ]);

      expect(mockFetch.mock.calls[0][0]).toBe('https://custom-gateway.example/auth/privy/exchange');
    });

    it('does not interfere with existing wallet login flow', async () => {
      // When --privy is NOT provided, the old wallet flow should still work
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ message: 'Sign this token message' }),
          text: async () => '',
        } as Partial<Response>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            token: 'mcpwt_wallet_flow',
            walletAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
            expiresAt: '2027-01-01T00:00:00Z',
          }),
          text: async () => '',
        } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const testPrivateKey = ['0xac0974bec39a17e36ba4a6b4d238ff944b', 'acb478cbed5efcae784d7bf4f2ff80'].join('');
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'auth', 'login',
        '--private-key', testPrivateKey,
      ]);

      // Should go through wallet-token flow, not Privy
      expect(mockFetch.mock.calls[0][0]).toContain('/api/auth/token-message');
      expect(store.getToken('default')?.token).toBe('mcpwt_wallet_flow');
    });
  });
});
