import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-mcp-test-'));
}

const MOCK_TOOLS = [
  { name: 'search_web', description: 'Search the web for information' },
  { name: 'get_stats', description: 'Get marketplace statistics' },
];

// Build a mock fetch that handles two sequential POST requests (initialize + tools/list or tools/call)
function makeMcpFetch(toolsOrResult: unknown) {
  let callCount = 0;
  return vi.fn().mockImplementation(async () => {
    callCount++;
    if (callCount === 1) {
      // initialize response
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'test-agent', version: '1.0' },
          },
        }),
        text: async () => '',
      } as unknown as Response;
    }
    // tools/list or tools/call response
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        jsonrpc: '2.0',
        id: 2,
        result: toolsOrResult,
      }),
      text: async () => '',
    } as unknown as Response;
  });
}

describe('mcp commands', () => {
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

  describe('mcp tools <agent-id>', () => {
    it('lists MCP tools in table format', async () => {
      const mockFetch = makeMcpFetch({ tools: MOCK_TOOLS });
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'tools', 'agent-1']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('search_web');
      expect(output).toContain('Search the web');
      expect(output).toContain('2 tool(s)');
      const initCallBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(initCallBody.params.protocolVersion).toBe('2025-03-26');
      expect(initCallBody.params.clientInfo.name).toBe('rickydata-cli');
    });

    it('lists MCP tools in JSON format', async () => {
      vi.stubGlobal('fetch', makeMcpFetch({ tools: MOCK_TOOLS }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'tools', 'agent-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('search_web');
    });

    it('shows empty message when no tools', async () => {
      vi.stubGlobal('fetch', makeMcpFetch({ tools: [] }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'tools', 'agent-1']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No MCP tools found');
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'tools', 'agent-1'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('mcp call <agent-id> <tool-name>', () => {
    it('calls a tool and shows JSON result', async () => {
      const toolResult = {
        content: [{ type: 'text', text: 'Search results here' }],
      };
      // callAgentMcpTool does 2 fetches: init + tools/call
      const initResponse = {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test', version: '1' } },
        }),
        text: async () => '',
      } as unknown as Response;
      const callResponse = {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ jsonrpc: '2.0', id: 3, result: toolResult }),
        text: async () => '',
      } as unknown as Response;

      const mockFetch = vi.fn()
        .mockResolvedValueOnce(initResponse)
        .mockResolvedValueOnce(callResponse);
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'mcp', 'call', 'agent-1', 'search_web',
        '{"query": "hello"}',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.content[0].text).toBe('Search results here');
    });

    it('rejects invalid JSON args', async () => {
      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'call', 'agent-1', 'tool', 'NOT JSON'])
      ).rejects.toThrow('Invalid JSON for args');
    });
  });
});
