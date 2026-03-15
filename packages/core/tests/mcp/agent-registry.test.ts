import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRegistry } from '../../src/mcp/agent-registry.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-registry-test-'));
}

describe('AgentRegistry', () => {
  let tmpDir: string;
  let registryPath: string;
  let registry: AgentRegistry;

  beforeEach(() => {
    tmpDir = makeTempDir();
    registryPath = path.join(tmpDir, 'mcp-agents.json');
    registry = new AgentRegistry(registryPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('enableAgent', () => {
    it('adds an agent to the registry', () => {
      registry.enableAgent('agent-1');

      const agents = registry.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('agent-1');
      expect(agents[0].enabledAt).toBeDefined();
    });

    it('does not duplicate an already-enabled agent', () => {
      registry.enableAgent('agent-1');
      registry.enableAgent('agent-1');

      expect(registry.listAgents()).toHaveLength(1);
    });

    it('persists to disk', () => {
      registry.enableAgent('agent-1');

      const raw = fs.readFileSync(registryPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.version).toBe(1);
      expect(data.agents).toHaveLength(1);
      expect(data.agents[0].agentId).toBe('agent-1');
    });

    it('creates the file with 0o600 permissions', () => {
      registry.enableAgent('agent-1');

      const stat = fs.statSync(registryPath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('disableAgent', () => {
    it('removes an agent from the registry', () => {
      registry.enableAgent('agent-1');
      registry.enableAgent('agent-2');
      registry.disableAgent('agent-1');

      const agents = registry.listAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('agent-2');
    });

    it('is a no-op for a non-existing agent', () => {
      registry.enableAgent('agent-1');
      registry.disableAgent('nonexistent');

      expect(registry.listAgents()).toHaveLength(1);
    });
  });

  describe('isEnabled', () => {
    it('returns true for enabled agents', () => {
      registry.enableAgent('agent-1');
      expect(registry.isEnabled('agent-1')).toBe(true);
    });

    it('returns false for non-enabled agents', () => {
      expect(registry.isEnabled('agent-1')).toBe(false);
    });
  });

  describe('listAgents', () => {
    it('returns empty array when no agents enabled', () => {
      expect(registry.listAgents()).toEqual([]);
    });

    it('returns a copy (not a reference)', () => {
      registry.enableAgent('agent-1');
      const list = registry.listAgents();
      list.push({ agentId: 'fake', enabledAt: '' });

      expect(registry.listAgents()).toHaveLength(1);
    });
  });

  describe('persistence across instances', () => {
    it('reads data written by another instance', () => {
      registry.enableAgent('agent-1');
      registry.enableAgent('agent-2');

      const registry2 = new AgentRegistry(registryPath);
      expect(registry2.listAgents()).toHaveLength(2);
      expect(registry2.isEnabled('agent-1')).toBe(true);
      expect(registry2.isEnabled('agent-2')).toBe(true);
    });
  });

  describe('corrupt file recovery', () => {
    it('recovers from corrupt JSON file', () => {
      fs.writeFileSync(registryPath, 'not json at all', 'utf-8');

      const registry2 = new AgentRegistry(registryPath);
      expect(registry2.listAgents()).toEqual([]);

      registry2.enableAgent('agent-1');
      expect(registry2.listAgents()).toHaveLength(1);
    });

    it('recovers from missing agents array', () => {
      fs.writeFileSync(registryPath, JSON.stringify({ version: 1 }), 'utf-8');

      const registry2 = new AgentRegistry(registryPath);
      expect(registry2.listAgents()).toEqual([]);
    });
  });

  describe('watch', () => {
    // fs.watch is unreliable on macOS temp directories (kqueue + /var/folders),
    // so we test the watcher returns a valid FSWatcher that can be closed
    it('returns a closeable FSWatcher', () => {
      registry.enableAgent('agent-1');

      const watcher = registry.watch(() => {});
      expect(watcher).toBeDefined();
      expect(typeof watcher.close).toBe('function');
      watcher.close();
    });

    it('creates the file if it does not exist', () => {
      const newPath = path.join(tmpDir, 'new-registry.json');
      const newRegistry = new AgentRegistry(newPath);

      const watcher = newRegistry.watch(() => {});
      try {
        expect(fs.existsSync(newPath)).toBe(true);
      } finally {
        watcher.close();
      }
    });
  });

  describe('reload', () => {
    it('forces a reload from disk', () => {
      registry.enableAgent('agent-1');

      // Write directly to the file
      const data = { version: 1, agents: [{ agentId: 'agent-X', enabledAt: '2025-01-01' }] };
      fs.writeFileSync(registryPath, JSON.stringify(data), 'utf-8');

      // Before reload, still cached
      expect(registry.listAgents()[0].agentId).toBe('agent-1');

      // After reload
      registry.reload();
      expect(registry.listAgents()[0].agentId).toBe('agent-X');
    });
  });
});
