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

// Gateway MCP fetch: all calls go to the same URL
// Gateway commands do init+call in sequence; tools list does init+list
function makeGatewayMcpFetch(secondResult: unknown, thirdResult?: unknown) {
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
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mcp-gateway', version: '1.0' } },
        }),
        text: async () => '',
      } as unknown as Response;
    }
    if (callCount === 2) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ jsonrpc: '2.0', id: 2, result: secondResult }),
        text: async () => '',
      } as unknown as Response;
    }
    // Third call (used by payment retry path: re-init + retry)
    if (callCount === 3 && thirdResult !== undefined) {
      // re-initialize for payment retry
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {} } }),
        text: async () => '',
      } as unknown as Response;
    }
    if (callCount === 4 && thirdResult !== undefined) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ jsonrpc: '2.0', id: 4, result: thirdResult }),
        text: async () => '',
      } as unknown as Response;
    }
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ jsonrpc: '2.0', id: callCount, result: thirdResult ?? secondResult }),
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

  // ── Agent MCP (now at mcp agent *) ──────────────────────────────────

  describe('mcp agent tools <agent-id>', () => {
    it('lists MCP tools in table format', async () => {
      const mockFetch = makeMcpFetch({ tools: MOCK_TOOLS });
      vi.stubGlobal('fetch', mockFetch);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'agent', 'tools', 'agent-1']);

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
      await program.parseAsync(['node', 'rickydata', 'mcp', 'agent', 'tools', 'agent-1', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('search_web');
    });

    it('shows empty message when no tools', async () => {
      vi.stubGlobal('fetch', makeMcpFetch({ tools: [] }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'agent', 'tools', 'agent-1']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No MCP tools found');
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'agent', 'tools', 'agent-1'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('mcp agent call <agent-id> <tool-name>', () => {
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
        'node', 'rickydata', 'mcp', 'agent', 'call', 'agent-1', 'search_web',
        '{"query": "hello"}',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.content[0].text).toBe('Search results here');
    });

    it('rejects invalid JSON args', async () => {
      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'agent', 'call', 'agent-1', 'tool', 'NOT JSON'])
      ).rejects.toThrow('Invalid JSON for args');
    });
  });

  // ── Gateway MCP commands ──────────────────────────────────────────

  describe('mcp search <query>', () => {
    it('shows search results in table format', async () => {
      const searchResult = JSON.stringify({
        servers: [
          { name: 'brave-search', title: 'Brave Search', toolsCount: 5, categories: ['search'], securityScore: 95, id: 'uuid-1' },
        ],
        total: 1,
        showing: 1,
      });

      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: searchResult }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'search', 'brave']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('brave-search');
      expect(output).toContain('Showing 1 of 1 servers');
    });

    it('shows search results in JSON format', async () => {
      const searchData = {
        servers: [{ name: 'filesystem', toolsCount: 8, categories: ['files'], securityScore: 90, id: 'uuid-2' }],
        total: 1,
        showing: 1,
      };

      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: JSON.stringify(searchData) }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'search', 'files', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.servers[0].name).toBe('filesystem');
    });

    it('shows no results message when empty', async () => {
      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: JSON.stringify({ servers: null }) }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'search', 'nothing']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No results');
    });
  });

  describe('mcp enable <name-or-id>', () => {
    it('enables a server by name', async () => {
      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: JSON.stringify({ enabled: true, server: { title: 'Brave Search', toolsCount: 5 } }) }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      // ora spinner writes to stderr — capture it too
      const stderrChunks: string[] = [];
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });

      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'enable', 'brave-search']);

      const stdoutOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const stderrOutput = stderrChunks.join('');
      const combined = stdoutOutput + stderrOutput;

      // The success message goes through ora (stderr) or console.log — check combined
      expect(combined).toContain('Brave Search');
      expect(combined).toContain('enabled');

      stderrSpy.mockRestore();
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'enable', 'some-server'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('mcp disable <name-or-id>', () => {
    it('disables a server by name', async () => {
      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: JSON.stringify({ disabled: true }) }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'disable', 'brave-search']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('disabled');
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'disable', 'some-server'])
      ).rejects.toThrow('Not authenticated');
    });
  });

  describe('mcp tools', () => {
    it('lists server tools filtering out gateway__ meta-tools', async () => {
      const toolsList = {
        tools: [
          { name: 'gateway__search_servers', description: 'meta tool' },
          { name: 'brave__search_web', description: 'Search the web' },
          { name: 'filesystem__read_file', description: 'Read a file' },
        ],
      };

      vi.stubGlobal('fetch', makeGatewayMcpFetch(toolsList));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'tools']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('brave__search_web');
      expect(output).toContain('filesystem__read_file');
      expect(output).not.toContain('gateway__search_servers');
      expect(output).toContain('2 tool(s) from enabled servers');
    });

    it('shows no-tools message when list is empty', async () => {
      vi.stubGlobal('fetch', makeGatewayMcpFetch({ tools: [] }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'tools']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('No server tools enabled');
    });

    it('requires authentication', async () => {
      store.clear();

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'tools'])
      ).rejects.toThrow('Not authenticated');
    });

    it('lists tools in JSON format', async () => {
      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        tools: [{ name: 'my__tool', description: 'A tool' }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'tools', '--format', 'json']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('my__tool');
    });
  });

  describe('mcp call <tool-name>', () => {
    it('calls a tool and shows the result', async () => {
      const toolResult = {
        content: [{ type: 'text', text: JSON.stringify({ answer: 42 }) }],
      };

      vi.stubGlobal('fetch', makeGatewayMcpFetch(toolResult));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync([
        'node', 'rickydata', 'mcp', 'call', 'brave__search_web', '{"query": "hello"}',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.answer).toBe(42);
    });

    it('rejects invalid JSON args', async () => {
      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'call', 'some_tool', 'NOT JSON'])
      ).rejects.toThrow('Invalid JSON for args');
    });

    it('shows payment required error when no private key', async () => {
      const paymentRequiredResult = {
        content: [{ type: 'text', text: JSON.stringify({ error: 'PAYMENT_REQUIRED', paymentRequirements: { priceUsd: '0.0005', payTo: '0xabc', network: 'base' } }) }],
      };

      vi.stubGlobal('fetch', makeGatewayMcpFetch(paymentRequiredResult));

      const program = createProgram(config, store);
      await expect(
        program.parseAsync(['node', 'rickydata', 'mcp', 'call', 'paid_tool'])
      ).rejects.toThrow('Payment required');
    });

    it('auto-pays x402 when private key is stored', async () => {
      // Store a private key
      store.setPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

      const paymentRequiredResult = {
        content: [{ type: 'text', text: JSON.stringify({
          error: 'PAYMENT_REQUIRED',
          paymentRequirements: {
            priceUsd: '0.0005',
            payTo: '0x2c241F8509BB6a7b672a440DFebd332cB0B258DE',
            network: 'base',
            maxAmountRequired: '500',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          },
        }) }],
      };

      const successResult = {
        content: [{ type: 'text', text: JSON.stringify({ data: 'paid result' }) }],
      };

      // Mock: call 1 = init, call 2 = tools/call (payment required), call 3 = re-init, call 4 = paid retry
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1 || callCount === 3) {
          // init responses
          return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {} } }),
            text: async () => '',
          } as unknown as Response;
        }
        if (callCount === 2) {
          return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ jsonrpc: '2.0', id: 3, result: paymentRequiredResult }),
            text: async () => '',
          } as unknown as Response;
        }
        // callCount === 4: paid retry
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ jsonrpc: '2.0', id: 4, result: successResult }),
          text: async () => '',
        } as unknown as Response;
      });
      vi.stubGlobal('fetch', mockFetch);

      // Mock viem/accounts, viem (for checkUsdcBalance), and payment-signer
      vi.mock('viem/accounts', () => ({
        privateKeyToAccount: () => ({
          address: '0x75992f829DF3B5d515D70DB0f77A98171cE261EF',
          signTypedData: async () => '0xsig',
        }),
      }));
      vi.mock('viem', () => ({
        createPublicClient: () => ({
          readContract: async () => BigInt(1_000_000), // 1.0 USDC — enough to cover $0.0005
        }),
        http: () => ({}),
      }));
      vi.mock('viem/chains', () => ({
        base: { id: 8453, name: 'Base' },
      }));
      vi.mock('../../src/payment/payment-signer.js', () => ({
        signPayment: async () => ({ header: 'base64mockpayment', receipt: {} }),
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'call', 'paid_tool']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('Paid $0.0005 USDC');
    });
  });

  describe('mcp info <name-or-id>', () => {
    it('shows server info in JSON format', async () => {
      const serverInfo = { name: 'brave-search', description: 'Brave search server', tools: 5 };

      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: JSON.stringify(serverInfo) }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'info', 'brave-search']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.name).toBe('brave-search');
    });

    it('shows server info by UUID', async () => {
      const serverInfo = { id: 'uuid-1234', name: 'my-server' };

      vi.stubGlobal('fetch', makeGatewayMcpFetch({
        content: [{ type: 'text', text: JSON.stringify(serverInfo) }],
      }));

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'info', '550e8400-e29b-41d4-a716-446655440000']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      const parsed = JSON.parse(output.trim());
      expect(parsed.id).toBe('uuid-1234');
    });
  });

  describe('mcp connect', () => {
    it('executes claude mcp add or prints command with token when authenticated', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'connect']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      // Either the command ran successfully or fell back to printing
      expect(
        output.includes('MCP Gateway added to Claude Code') ||
        output.includes('claude mcp add'),
      ).toBe(true);
    });

    it('prints command in dry-run mode with token', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'connect', '--dry-run']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('claude mcp add');
      expect(output).toContain('--transport http');
      expect(output).toContain('mcp-gateway');
      expect(output).toContain('mcp.rickydata.org/mcp');
      expect(output).toContain('Authorization:Bearer mcpwt_test');
    });

    it('prints unauthenticated command in dry-run mode when not logged in', async () => {
      store.clear();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const program = createProgram(config, store);
      await program.parseAsync(['node', 'rickydata', 'mcp', 'connect', '--dry-run']);

      const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('claude mcp add --transport http mcp-gateway');
      expect(output).not.toContain('Authorization');
    });
  });
});
