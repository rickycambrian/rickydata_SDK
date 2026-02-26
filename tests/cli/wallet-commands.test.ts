import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-wallet-test-'));
}

describe('wallet commands', () => {
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

  describe('wallet balance', () => {
    it('shows balance in table format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          balance: '10.50',
          depositAddress: '0xdepositaddr',
          walletAddress: '0xmywallet',
          estimatedMessages: 2100,
        }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'wallet', 'balance']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('10.50');
      expect(output).toContain('0xdepositaddr');
    });

    it('shows balance in JSON format', async () => {
      const balanceData = { balance: '5.00', depositAddress: '0xaddr' };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => balanceData,
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'wallet', 'balance', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.balance).toBe('5.00');
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'wallet', 'balance'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('wallet transactions', () => {
    it('lists transactions in table format', async () => {
      const txData = {
        transactions: [
          { createdAt: '2026-02-01', type: 'payment', amount: '0.0005', status: 'settled', txHash: '0xabc123' },
          { createdAt: '2026-02-02', type: 'deposit', amount: '10.00', status: 'confirmed', txHash: '0xdef456' },
        ],
      };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => txData,
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'wallet', 'transactions']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('payment');
      expect(output).toContain('2 transaction(s)');
    });

    it('passes limit to API', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ transactions: [] }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'wallet', 'transactions', '--limit', '5']);

      expect(mockFetch.mock.calls[0][0]).toContain('limit=5');
    });
  });

  describe('wallet settings set', () => {
    it('uses PUT and parses primitive values before sending', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'wallet', 'settings', 'set', 'persistConversations', 'true',
      ]);

      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/wallet/settings');
      expect(call[1].method).toBe('PUT');
      expect(call[1].body).toBe(JSON.stringify({ persistConversations: true }));
    });

    it('rejects unknown setting keys before making a request', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);

      const program = createProgram(config, store);
      await expect(
        program.parseAsync([
          'node', 'rickydata', 'wallet', 'settings', 'set', 'unknownSetting', 'true',
        ])
      ).rejects.toThrow("Unknown wallet setting 'unknownSetting'");

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
