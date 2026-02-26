import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-sessions-test-'));
}

const MOCK_SESSIONS = [
  { id: 'sess-abc', agentId: 'agent-1', messageCount: 5, model: 'haiku', lastActive: '2026-02-20T10:00:00Z' },
  { id: 'sess-def', agentId: 'agent-2', messageCount: 12, model: 'sonnet', lastActive: '2026-02-21T14:00:00Z' },
];

describe('sessions commands', () => {
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

  describe('sessions list', () => {
    it('lists sessions in table format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: MOCK_SESSIONS }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'sessions', 'list', 'agent-1']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('sess-abc');
      expect(output).toContain('2 session(s)');
    });

    it('lists sessions in JSON format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: MOCK_SESSIONS }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'sessions', 'list', 'agent-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe('sess-abc');
    });

    it('filters by agent-id when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions: [MOCK_SESSIONS[0]] }),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'sessions', 'list', 'agent-1']);

      expect(mockFetch.mock.calls[0][0]).toContain('agent-1');
    });

    it('exits with error if not authenticated', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'sessions', 'list'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('sessions get', () => {
    it('shows session details', async () => {
      const sessionDetail = {
        ...MOCK_SESSIONS[0],
        messages: [
          { role: 'user', content: 'Hello agent' },
          { role: 'assistant', content: 'Hello user' },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => sessionDetail,
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'sessions', 'get', 'agent-1', 'sess-abc']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('sess-abc');
      expect(output).toContain('haiku');
      expect(output).toContain('Hello agent');
    });

    it('shows session in JSON format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => MOCK_SESSIONS[0],
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'sessions', 'get', 'agent-1', 'sess-abc', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.id).toBe('sess-abc');
    });
  });

  describe('sessions delete', () => {
    it('deletes session with --yes flag (no prompt)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
        text: async () => '',
      } as Partial<Response>);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'sessions', 'delete', 'agent-1', 'sess-abc', '--yes']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('deleted');
      const call = mockFetch.mock.calls.find((c) => c[1]?.method === 'DELETE');
      expect(call).toBeDefined();
    });
  });
});
