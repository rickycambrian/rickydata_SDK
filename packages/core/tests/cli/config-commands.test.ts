import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-config-cmd-test-'));
}

describe('config commands', () => {
  let tmpDir: string;
  let config: ConfigManager;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = new ConfigManager(path.join(tmpDir, 'config.json'));
    store = new CredentialStore(path.join(tmpDir, 'credentials.json'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('config set', () => {
    it('sets a configuration value', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'set', 'agentGatewayUrl', 'https://custom.example.com']);
      expect(config.get('agentGatewayUrl')).toBe('https://custom.example.com');
    });

    it('sets a value in a specific profile', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'config', 'set', 'foo', 'bar', '--profile', 'custom',
      ]);
      expect(config.get('foo', 'custom')).toBe('bar');
      expect(config.get('foo')).toBeUndefined();
    });
  });

  describe('config get', () => {
    it('retrieves a set value', async () => {
      config.set('testKey', 'testValue');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'get', 'testKey']);
      expect(consoleSpy.mock.calls.some((c) => c.join(' ').includes('testValue'))).toBe(true);
    });

    it('shows warning for missing key', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'get', 'missingKey']);
      expect(consoleSpy.mock.calls.some((c) => c.join(' ').includes('not found'))).toBe(true);
    });
  });

  describe('config list', () => {
    it('shows all config values', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'list']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('agentGatewayUrl');
    });

    it('outputs JSON when format=json', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'list', '--format', 'json']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('"agentGatewayUrl"');
    });
  });

  describe('config activate', () => {
    it('switches the active profile', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'activate', 'staging']);
      expect(config.getActiveProfile()).toBe('staging');
    });
  });

  describe('config profiles', () => {
    it('lists available profiles', async () => {
      config.setActiveProfile('prod');
      config.setActiveProfile('staging');
      config.setActiveProfile('default');

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'config', 'profiles']);
      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('default');
      expect(output).toContain('prod');
      expect(output).toContain('staging');
    });
  });
});
