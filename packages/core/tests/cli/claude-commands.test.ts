import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';
import {
  base64url,
  generatePkce,
  buildAuthorizeUrl,
  buildBundle,
  normalizeLocalClaudeOAuthBundle,
} from '../../src/cli/commands/claude.js';

// `open` would try to launch a real browser — stub it.
vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// readline can't be spied in ESM — mock it and defer the answer to a runtime hook
// the test installs on globalThis (so it can read the just-printed authorize URL).
vi.mock('readline', () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (answer: string) => void) => {
      cb((globalThis as Record<string, unknown>).__claudePasteAnswer
        ? ((globalThis as Record<string, unknown>).__claudePasteAnswer as () => string)()
        : '');
    },
    close: () => {},
  }),
}));
// Wallet signing is exercised via the derive-challenge → sign → PUT path.
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: () => ({
    signMessage: async () => '0xmocksignature',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  }),
}));

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-claude-test-'));
}

describe('claude OAuth helpers', () => {
  it('derives a PKCE S256 challenge that matches the verifier', () => {
    const { verifier, challenge } = generatePkce();
    const expected = base64url(crypto.createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
    expect(challenge).not.toContain('=');
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
  });

  it('builds an authorize URL matching the live Claude Code flow', () => {
    const url = new URL(buildAuthorizeUrl({
      base: 'https://claude.ai/oauth/authorize',
      redirectUri: 'http://localhost:51234/callback',
      challenge: 'CHALLENGE',
      state: 'STATE',
    }));
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('client_id')).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:51234/callback');
    expect(url.searchParams.get('scope')).toBe('org:create_api_key user:profile user:inference user:sessions:claude_code');
    expect(url.searchParams.get('code_challenge')).toBe('CHALLENGE');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('STATE');
  });

  it('builds a canonical claudeAiOauth bundle and never leaks raw scope strings', () => {
    const bundle = buildBundle({
      access_token: 'sk-ant-oat-SECRET',
      refresh_token: 'sk-ant-ort-SECRET',
      expires_in: 3600,
      scope: 'org:create_api_key user:profile',
    }, 1_000_000);
    expect(bundle.claudeAiOauth.accessToken).toBe('sk-ant-oat-SECRET');
    expect(bundle.claudeAiOauth.refreshToken).toBe('sk-ant-ort-SECRET');
    expect(bundle.claudeAiOauth.expiresAt).toBe(1_000_000 + 3600 * 1000);
    expect(bundle.claudeAiOauth.scopes).toEqual(['org:create_api_key', 'user:profile']);
  });

  it('falls back to default scopes when token response omits scope', () => {
    const bundle = buildBundle({ access_token: 'a', refresh_token: 'r' }, 0);
    expect(bundle.claudeAiOauth.scopes).toEqual([
      'org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code',
    ]);
    expect(bundle.claudeAiOauth.expiresAt).toBe(3600 * 1000);
  });

  it('normalizes the credential shape written by Claude Code', () => {
    const bundle = normalizeLocalClaudeOAuthBundle({ claudeAiOauth: {
      accessToken: 'sk-ant-oat-LOCAL',
      refreshToken: 'sk-ant-ort-LOCAL',
      expiresAt: 123_456,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    } });

    expect(bundle.claudeAiOauth).toEqual({
      accessToken: 'sk-ant-oat-LOCAL',
      refreshToken: 'sk-ant-ort-LOCAL',
      expiresAt: 123_456,
      scopes: ['user:inference'],
      subscriptionType: 'max',
    });
  });
});

describe('claude commands', () => {
  let tmpDir: string;
  let config: ConfigManager;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = new ConfigManager(path.join(tmpDir, 'config.json'));
    store = new CredentialStore(path.join(tmpDir, 'credentials.json'));
    store.setToken('mcpwt_test', '0xtest');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('claude status', () => {
    it('shows configured status with scopes (no token text)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ configured: true, hasTokens: true, scopes: ['user:inference'], encryptionMode: 'sign-to-derive', unlocked: true }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'claude', 'status']);

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/wallet/anthropic-oauth/status');
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Configured');
      expect(output).toContain('user:inference');
      expect(output).not.toContain('0xtest');
    });

    it('uses the gateway hasRefreshToken field for token status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ configured: true, hasRefreshToken: true, unlocked: true }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'claude', 'status']);

      expect(consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('Tokens present: yes');
    });

    it('shows not configured status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ configured: false }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'claude', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Not configured');
    });
  });

  describe('claude delete', () => {
    it('sends DELETE to the anthropic-oauth endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'claude', 'delete']);

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('DELETE');
      expect(call[0]).toContain('/wallet/anthropic-oauth');
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('deleted');
    });
  });

  describe('claude unlock', () => {
    it('signs a challenge and posts to the unlock endpoint', async () => {
      store.setPrivateKey('0x' + 'a'.repeat(64));
      const calls: Array<{ url: string; opts: RequestInit }> = [];
      const mockFetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        calls.push({ url, opts: opts ?? {} });
        if (url.includes('derive-challenge')) {
          return { ok: true, json: async () => ({ message: 'Sign Anthropic OAuth', nonce: 'n-1' }), text: async () => '' };
        }
        return { ok: true, json: async () => ({ configured: true, encryptionMode: 'sign-to-derive', unlocked: true }), text: async () => '' };
      });
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'claude', 'unlock']);

      expect(calls[0].url).toContain('/wallet/anthropic-oauth/derive-challenge');
      const post = calls.find((c) => c.opts?.method === 'POST');
      expect(post!.url).toContain('/wallet/anthropic-oauth/unlock');
      const body = JSON.parse(post!.opts.body as string);
      expect(body.signature).toBe('0xmocksignature');
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('unlocked');
    });
  });

  describe('claude sync --paste (end-to-end round trip)', () => {
    it('exchanges the pasted code and uploads a wallet-signed bundle without printing tokens', async () => {
      store.setPrivateKey('0x' + 'a'.repeat(64));
      const origInTTY = process.stdin.isTTY;
      const origOutTTY = process.stdout.isTTY;
      (process.stdin as { isTTY?: boolean }).isTTY = true;
      (process.stdout as { isTTY?: boolean }).isTTY = true;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // The mocked readline (top of file) calls this hook to produce the pasted
      // value — we read the just-printed authorize URL and echo back `code#state`
      // with the SAME state so the CSRF check passes.
      (globalThis as Record<string, unknown>).__claudePasteAnswer = () => {
        const printed = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        const match = printed.match(/https:\/\/\S*oauth\/authorize\S+/);
        const state = match ? new URL(match[0]).searchParams.get('state') : 'missing';
        return `AUTH_CODE_123#${state}`;
      };

      const ACCESS = 'sk-ant-oat-SHOULD-NEVER-PRINT';
      const REFRESH = 'sk-ant-ort-SHOULD-NEVER-PRINT';
      const calls: Array<{ url: string; opts: RequestInit }> = [];
      const mockFetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        calls.push({ url, opts: opts ?? {} });
        if (url.includes('/v1/oauth/token')) {
          return {
            ok: true,
            json: async () => ({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: 'user:inference user:profile' }),
            text: async () => '',
          };
        }
        if (url.includes('derive-challenge')) {
          return { ok: true, json: async () => ({ message: 'Sign Anthropic OAuth', nonce: 'n-1' }), text: async () => '' };
        }
        // PUT /wallet/anthropic-oauth
        return { ok: true, json: async () => ({ configured: true, hasTokens: true, scopes: ['user:inference', 'user:profile'], encryptionMode: 'sign-to-derive', unlocked: true }), text: async () => '' };
      });
      vi.stubGlobal('fetch', mockFetch);

      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'claude', 'sync', '--paste']);
      (process.stdin as { isTTY?: boolean }).isTTY = origInTTY;
      (process.stdout as { isTTY?: boolean }).isTTY = origOutTTY;

      // 1. Token exchange used the correct endpoint, body, and manual redirect_uri.
      const tokenCall = calls.find((c) => c.url.includes('/v1/oauth/token'));
      expect(tokenCall).toBeDefined();
      expect(tokenCall!.opts.method).toBe('POST');
      const tokenBody = JSON.parse(tokenCall!.opts.body as string);
      expect(tokenBody.grant_type).toBe('authorization_code');
      expect(tokenBody.code).toBe('AUTH_CODE_123');
      expect(tokenBody.client_id).toBe('9d1c250a-e61b-44d9-88ed-5944d1962f5e');
      expect(tokenBody.redirect_uri).toBe('https://console.anthropic.com/oauth/code/callback');
      expect(typeof tokenBody.code_verifier).toBe('string');

      // 2. The bundle was uploaded via a wallet-signed PUT carrying the real tokens.
      const putCall = calls.find((c) => c.opts?.method === 'PUT');
      expect(putCall!.url).toContain('/wallet/anthropic-oauth');
      const putBody = JSON.parse(putCall!.opts.body as string);
      expect(putBody.signature).toBe('0xmocksignature');
      expect(putBody.nonce).toBe('n-1');
      // SHARED CONTRACT: the gateway reads the bundle from `credentials`.
      expect(putBody.credentials.claudeAiOauth.accessToken).toBe(ACCESS);
      expect(putBody.credentials.claudeAiOauth.refreshToken).toBe(REFRESH);

      // 3. Tokens are NEVER printed to the console.
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('synced');
      expect(output).not.toContain(ACCESS);
      expect(output).not.toContain(REFRESH);
    });
  });

  describe('claude sync --from-local', () => {
    it('uploads the current local Claude Code bundle without a browser login', async () => {
      store.setPrivateKey('0x' + 'a'.repeat(64));
      const credentialsPath = path.join(tmpDir, 'claude-credentials.json');
      fs.writeFileSync(credentialsPath, JSON.stringify({ claudeAiOauth: {
        accessToken: 'sk-ant-oat-LOCAL',
        refreshToken: 'sk-ant-ort-LOCAL',
        expiresAt: 123_456,
        scopes: ['user:inference'],
        subscriptionType: 'max',
      } }));
      const calls: Array<{ url: string; opts: RequestInit }> = [];
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
        calls.push({ url, opts: opts ?? {} });
        if (url.includes('derive-challenge')) {
          return { ok: true, json: async () => ({ message: 'Sign Anthropic OAuth', nonce: 'n-1' }), text: async () => '' };
        }
        return { ok: true, json: async () => ({ configured: true, hasRefreshToken: true, unlocked: true }), text: async () => '' };
      }));
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'claude', 'sync', '--from-local', '--yes', '--auth-path', credentialsPath,
      ]);

      const put = calls.find((call) => call.opts.method === 'PUT');
      expect(put).toBeDefined();
      const body = JSON.parse(put!.opts.body as string);
      expect(body.credentials.claudeAiOauth.subscriptionType).toBe('max');
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('synced');
      expect(output).not.toContain('sk-ant-oat-LOCAL');
      expect(output).not.toContain('sk-ant-ort-LOCAL');
      expect(output).not.toContain('oauth/authorize');
    });
  });
});
