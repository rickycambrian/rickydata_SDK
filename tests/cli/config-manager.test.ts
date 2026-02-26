import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-config-test-'));
}

describe('ConfigManager', () => {
  let tmpDir: string;
  let configPath: string;
  let manager: ConfigManager;

  beforeEach(() => {
    tmpDir = makeTempDir();
    configPath = path.join(tmpDir, 'config.json');
    manager = new ConfigManager(configPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('defaults', () => {
    it('returns default active profile', () => {
      expect(manager.getActiveProfile()).toBe('default');
    });

    it('returns default agent gateway URL', () => {
      expect(manager.getAgentGatewayUrl()).toBe('https://agents.rickydata.org');
    });

    it('returns default mcp gateway URL', () => {
      expect(manager.getMcpGatewayUrl()).toBe('https://mcp.rickydata.org');
    });

    it('lists default profile', () => {
      expect(manager.listProfiles()).toContain('default');
    });
  });

  describe('set and get', () => {
    it('sets and gets a value in the active profile', () => {
      manager.set('someKey', 'someValue');
      expect(manager.get('someKey')).toBe('someValue');
    });

    it('returns undefined for missing key', () => {
      expect(manager.get('nonExistent')).toBeUndefined();
    });

    it('sets and gets a value in a named profile', () => {
      manager.set('foo', 'bar', 'custom');
      expect(manager.get('foo', 'custom')).toBe('bar');
    });

    it('persists values across instances', () => {
      manager.set('key1', 'value1');
      const manager2 = new ConfigManager(configPath);
      expect(manager2.get('key1')).toBe('value1');
    });
  });

  describe('profiles', () => {
    it('creates a new profile with setActiveProfile', () => {
      manager.setActiveProfile('staging');
      expect(manager.getActiveProfile()).toBe('staging');
      expect(manager.listProfiles()).toContain('staging');
    });

    it('switching profiles isolates values', () => {
      manager.set('url', 'https://prod.example.com', 'prod');
      manager.set('url', 'https://staging.example.com', 'staging');
      expect(manager.get('url', 'prod')).toBe('https://prod.example.com');
      expect(manager.get('url', 'staging')).toBe('https://staging.example.com');
    });

    it('persists active profile change', () => {
      manager.setActiveProfile('myprofile');
      const manager2 = new ConfigManager(configPath);
      expect(manager2.getActiveProfile()).toBe('myprofile');
    });
  });

  describe('list', () => {
    it('returns all values for the active profile', () => {
      manager.set('agentGatewayUrl', 'https://custom.example.com');
      const values = manager.list();
      expect(values.agentGatewayUrl).toBe('https://custom.example.com');
    });
  });

  describe('corrupted config', () => {
    it('falls back to defaults when config file is malformed', () => {
      fs.writeFileSync(configPath, 'NOT VALID JSON', 'utf-8');
      const manager2 = new ConfigManager(configPath);
      expect(manager2.getActiveProfile()).toBe('default');
    });
  });
});
