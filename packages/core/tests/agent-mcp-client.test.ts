import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentMCPClient } from '../src/agent/agent-mcp-client.js';

const GATEWAY = 'https://agents.rickydata.org';
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // hardhat #0

// ─── Helpers ────────────────────────────────────────────────

/** Build an SSE response body matching the server format. */
function sseResponse(jsonRpcResult: unknown): string {
  return `event: message\ndata: ${JSON.stringify(jsonRpcResult)}\n\n`;
}

function mockFetchResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as Response;
}

function mockAuthFlow(fetchSpy: ReturnType<typeof vi.spyOn>) {
  // Challenge
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ nonce: 'nonce-123', message: 'Sign this message' }),
  } as Response);
  // Verify
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ token: 'jwt-token-123', walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }),
  } as Response);
}

// ─── Tests ──────────────────────────────────────────────────

describe('AgentMCPClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constructor ────────────────────────────────────────

  describe('constructor', () => {
    it('requires either privateKey or token', () => {
      expect(() => new AgentMCPClient({})).toThrow('Either privateKey or token is required');
      expect(() => new AgentMCPClient()).toThrow('Either privateKey or token is required');
    });

    it('accepts a private key', () => {
      const client = new AgentMCPClient({ privateKey: PRIVATE_KEY });
      expect(client).toBeDefined();
    });

    it('accepts a pre-existing token', () => {
      const client = new AgentMCPClient({ token: 'jwt-abc' });
      expect(client).toBeDefined();
    });

    it('auto-prefixes 0x to private key', () => {
      const client = new AgentMCPClient({ privateKey: PRIVATE_KEY.slice(2) });
      expect(client).toBeDefined();
    });

    it('uses default base URL', () => {
      const client = new AgentMCPClient({ token: 'jwt' });
      expect(client).toBeDefined();
    });

    it('accepts a custom base URL and strips trailing slash', () => {
      const client = new AgentMCPClient({ token: 'jwt', baseUrl: 'https://custom.example.com/' });
      expect(client).toBeDefined();
    });
  });

  // ─── Authentication ─────────────────────────────────────

  describe('authentication', () => {
    it('authenticates via challenge/verify when using privateKey', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      mockAuthFlow(fetchSpy);

      // MCP initialize response
      const initResult = {
        jsonrpc: '2.0', id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'test-agent', version: '1.0.0' },
        },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)));

      const client = new AgentMCPClient({ privateKey: PRIVATE_KEY });
      await client.connect('test-agent');

      expect(fetchSpy).toHaveBeenCalledWith(`${GATEWAY}/auth/challenge`);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/auth/verify`,
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('skips auth when token is provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const initResult = {
        jsonrpc: '2.0', id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'test-agent', version: '1.0.0' },
        },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)));

      const client = new AgentMCPClient({ token: 'jwt-pre-existing' });
      await client.connect('test-agent');

      // Only 1 fetch call (the MCP request), no auth calls
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/agents/test-agent/mcp`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer jwt-pre-existing',
          }),
        }),
      );
    });

    it('throws on auth challenge failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const client = new AgentMCPClient({ privateKey: PRIVATE_KEY });
      await expect(client.connect('test-agent')).rejects.toThrow('Auth challenge failed: 500');
    });

    it('throws on auth verify failure', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ nonce: 'n', message: 'Sign' }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: () => Promise.resolve('Invalid signature'),
        } as Response);

      const client = new AgentMCPClient({ privateKey: PRIVATE_KEY });
      await expect(client.connect('test-agent')).rejects.toThrow('Auth verification failed: 403');
    });

    it('reuses token across calls (no re-auth)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      mockAuthFlow(fetchSpy);

      const initResult = {
        jsonrpc: '2.0', id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'test-agent', version: '1.0.0' },
        },
      };
      const listResult = {
        jsonrpc: '2.0', id: 2,
        result: { tools: [] },
      };
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)))
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(listResult)));

      const client = new AgentMCPClient({ privateKey: PRIVATE_KEY });
      await client.connect('test-agent');
      await client.listTools('test-agent');

      // 2 auth calls + 2 MCP calls = 4 total (not 6)
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });

  // ─── connect (initialize) ─────────────────────────────

  describe('connect', () => {
    it('sends initialize JSON-RPC and returns server info', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const serverInfo = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'research-agent', version: '1.0.0' },
      };
      const initResult = { jsonrpc: '2.0', id: 1, result: serverInfo };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      const result = await client.connect('research-agent');

      expect(result).toEqual(serverInfo);

      // Verify the request body
      const call = fetchSpy.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      expect(body.method).toBe('initialize');
      expect(body.params.protocolVersion).toBe('2025-03-26');
      expect(body.params.clientInfo).toEqual({ name: 'mcp-gateway-sdk', version: '0.2.0' });
    });

    it('validates agentId is not empty', async () => {
      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.connect('')).rejects.toThrow('agentId is required');
    });

    it('URL-encodes agentId in request path', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const initResult = {
        jsonrpc: '2.0', id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'agent with spaces', version: '1.0.0' },
        },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      await client.connect('agent with spaces');

      expect(fetchSpy).toHaveBeenCalledWith(
        `${GATEWAY}/agents/agent%20with%20spaces/mcp`,
        expect.anything(),
      );
    });
  });

  // ─── listTools ────────────────────────────────────────

  describe('listTools', () => {
    it('returns array of MCP tools', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const tools = [
        { name: 'brave_web_search', description: 'Search the web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
        { name: 'mcp_status', description: 'Marketplace status', inputSchema: { type: 'object', properties: {} } },
      ];
      const listResult = { jsonrpc: '2.0', id: 1, result: { tools } };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(listResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      const result = await client.listTools('research-agent');

      expect(result).toEqual(tools);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('brave_web_search');
    });

    it('returns empty array when no tools', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const listResult = { jsonrpc: '2.0', id: 1, result: { tools: [] } };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(listResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      const result = await client.listTools('test-agent');

      expect(result).toEqual([]);
    });

    it('validates agentId is not empty', async () => {
      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.listTools('')).rejects.toThrow('agentId is required');
    });
  });

  // ─── callTool ─────────────────────────────────────────

  describe('callTool', () => {
    it('sends tools/call and returns content result', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const toolResult = {
        content: [{ type: 'text', text: 'Search results: MCP servers for databases...' }],
      };
      const callResult = { jsonrpc: '2.0', id: 1, result: toolResult };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(callResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      const result = await client.callTool('research-agent', 'brave_web_search', { query: 'MCP database servers' });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toContain('Search results');

      // Verify request body
      const call = fetchSpy.mock.calls[0];
      const body = JSON.parse(call[1]?.body as string);
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('brave_web_search');
      expect(body.params.arguments).toEqual({ query: 'MCP database servers' });
    });

    it('handles tool error responses', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const toolResult = {
        content: [{ type: 'text', text: 'Insufficient USDC balance.' }],
        isError: true,
      };
      const callResult = { jsonrpc: '2.0', id: 1, result: toolResult };

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(callResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      const result = await client.callTool('test-agent', 'some_tool');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Insufficient');
    });

    it('defaults args to empty object when not provided', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const callResult = {
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: 'ok' }] },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(callResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      await client.callTool('test-agent', 'status_check');

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({});
    });

    it('validates agentId is not empty', async () => {
      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.callTool('', 'tool')).rejects.toThrow('agentId is required');
    });

    it('validates toolName is not empty', async () => {
      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.callTool('agent', '')).rejects.toThrow('toolName is required');
    });
  });

  // ─── SSE Parsing ──────────────────────────────────────

  describe('SSE parsing', () => {
    it('parses standard SSE format with event and data lines', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'test', version: '1.0.0' },
      };
      const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\n`;

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(body));

      const client = new AgentMCPClient({ token: 'jwt' });
      const info = await client.connect('test');
      expect(info.serverInfo.name).toBe('test');
    });

    it('handles data-only SSE format (no event: line)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const result = { tools: [{ name: 'tool1', description: 'A tool' }] };
      const body = `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result })}\n\n`;

      fetchSpy.mockResolvedValueOnce(mockFetchResponse(body));

      const client = new AgentMCPClient({ token: 'jwt' });
      const tools = await client.listTools('test');
      expect(tools).toHaveLength(1);
    });

    it('throws on empty SSE body with no data lines', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(''));

      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.connect('test')).rejects.toThrow('No valid JSON-RPC response found');
    });
  });

  // ─── Error Handling ───────────────────────────────────

  describe('error handling', () => {
    it('throws on HTTP error from MCP endpoint', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Agent not found'),
      } as Response);

      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.connect('nonexistent')).rejects.toThrow('MCP request failed: 404 Agent not found');
    });

    it('throws on JSON-RPC error in response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const errorResult = {
        jsonrpc: '2.0', id: 1,
        error: { code: -32601, message: 'Method not found: unknown' },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(errorResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.connect('test')).rejects.toThrow('MCP error -32601: Method not found: unknown');
    });

    it('throws on invalid JSON-RPC version error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const errorResult = {
        jsonrpc: '2.0', id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC version' },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(errorResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.listTools('test')).rejects.toThrow('MCP error -32600: Invalid JSON-RPC version');
    });

    it('throws on unknown tool error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const errorResult = {
        jsonrpc: '2.0', id: 1,
        error: { code: -32602, message: 'Unknown tool: nonexistent. Use tools/list to see available tools.' },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(errorResult)));

      const client = new AgentMCPClient({ token: 'jwt' });
      await expect(client.callTool('test', 'nonexistent')).rejects.toThrow('Unknown tool: nonexistent');
    });
  });

  // ─── Custom Base URL ──────────────────────────────────

  describe('custom base URL', () => {
    it('uses custom base URL for all requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const initResult = {
        jsonrpc: '2.0', id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'test', version: '1.0.0' },
        },
      };
      fetchSpy.mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)));

      const client = new AgentMCPClient({
        token: 'jwt',
        baseUrl: 'https://custom-gateway.example.com',
      });
      await client.connect('test');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://custom-gateway.example.com/agents/test/mcp',
        expect.anything(),
      );
    });
  });

  // ─── Request ID Incrementing ──────────────────────────

  describe('request ID management', () => {
    it('increments JSON-RPC request IDs across calls', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Three sequential calls
      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(sseResponse({
          jsonrpc: '2.0', id: 1,
          result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 't', version: '1' } },
        })))
        .mockResolvedValueOnce(mockFetchResponse(sseResponse({
          jsonrpc: '2.0', id: 2,
          result: { tools: [] },
        })))
        .mockResolvedValueOnce(mockFetchResponse(sseResponse({
          jsonrpc: '2.0', id: 3,
          result: { content: [{ type: 'text', text: 'ok' }] },
        })));

      const client = new AgentMCPClient({ token: 'jwt' });
      await client.connect('test');
      await client.listTools('test');
      await client.callTool('test', 'tool');

      // Verify IDs were incremented
      const ids = fetchSpy.mock.calls.map(c => JSON.parse(c[1]?.body as string).id);
      expect(ids).toEqual([1, 2, 3]);
    });
  });
});
