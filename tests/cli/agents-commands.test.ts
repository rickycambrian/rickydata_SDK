import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-agents-cmd-test-'));
}

const MOCK_AGENTS = [
  { id: 'agent-1', name: 'Alpha Agent', model: 'claude-opus-4-6', source: 'marketplace', status: 'active' },
  { id: 'agent-2', name: 'Beta Agent', model: 'claude-haiku-4-5', source: 'custom', status: 'active' },
];

describe('agents commands', () => {
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

  describe('agents list', () => {
    it('lists agents in table format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agents: MOCK_AGENTS }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('agent-1');
      expect(output).toContain('Alpha Agent');
      expect(output).toContain('2 agent(s)');
    });

    it('lists agents in JSON format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agents: MOCK_AGENTS }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'list', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('agent-1');
    });

    it('shows empty message when no agents', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agents: [] }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No agents found');
    });

    it('includes auth header when token is present', async () => {
      store.setToken('mcpwt_mytoken', '0x123');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ agents: MOCK_AGENTS }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'list']);

      const call = mockFetch.mock.calls[0];
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer mcpwt_mytoken');
    });

    it('handles API error gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'agents', 'list'])
      ).rejects.toThrow('Failed to list agents');
    });
  });

  describe('agents describe', () => {
    it('shows detailed agent info', async () => {
      const agentDetail = {
        ...MOCK_AGENTS[0],
        description: 'A helpful agent for data analysis',
        skills: ['search', 'summarize', 'analyze'],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => agentDetail,
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'describe', 'agent-1']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('agent-1');
      expect(output).toContain('Alpha Agent');
      expect(output).toContain('A helpful agent for data analysis');
      expect(output).toContain('search');
      expect(output).toContain('summarize');
    });

    it('shows agent in JSON format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_AGENTS[0],
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'describe', 'agent-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.id).toBe('agent-1');
    });

    it('calls correct endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_AGENTS[0],
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'agents', 'describe', 'agent-1', '--gateway', 'https://test.example.com']);

      expect(mockFetch.mock.calls[0][0]).toBe('https://test.example.com/agents/agent-1');
    });
  });
});
