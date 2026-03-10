import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-apikey-test-'));
}

describe('apikey commands', () => {
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

  describe('apikey set --key', () => {
    it('sends API key to gateway', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'apikey', 'set', '--key', 'sk-ant-testkey123']);

      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/wallet/apikey');
      expect(call[1].method).toBe('PUT');
      const body = JSON.parse(call[1].body);
      expect(body.anthropicApiKey).toBe('sk-ant-testkey123');

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('configured successfully');
    });

    it('rejects key not starting with sk-ant-', async () => {
      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'apikey', 'set', '--key', 'invalid-key'])
      ).rejects.toThrow('Invalid API key');
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'apikey', 'set', '--key', 'sk-ant-test'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('apikey status', () => {
    it('shows configured status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ configured: true }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'apikey', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Configured');
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
      await program.parseAsync(['node', 'rickydata', 'apikey', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Not configured');
    });
  });

  describe('apikey delete', () => {
    it('sends DELETE request to gateway', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'apikey', 'delete']);

      const call = mockFetch.mock.calls[0];
      expect(call[1].method).toBe('DELETE');
      expect(call[0]).toContain('/wallet/apikey');

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('removed');
    });
  });
});
