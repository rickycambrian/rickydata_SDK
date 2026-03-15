import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentMCPProxy } from '../../src/mcp/agent-mcp-proxy.js';
import { AgentRegistry } from '../../src/mcp/agent-registry.js';

const GATEWAY = 'https://agents.rickydata.org';
const TOKEN = 'mcpwt_test_token';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-proxy-test-'));
}

/** Build an SSE response body matching the server format. */
function sseResponse(jsonRpcResult: unknown): string {
  return `event: message\ndata: ${JSON.stringify(jsonRpcResult)}\n\n`;
}

function mockFetchResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    headers: { get: () => 'text/event-stream' },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response;
}

describe('AgentMCPProxy', () => {
  let tmpDir: string;
  let registry: AgentRegistry;

  beforeEach(() => {
    tmpDir = makeTempDir();
    registry = new AgentRegistry(path.join(tmpDir, 'mcp-agents.json'));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('returns listChanged: true in capabilities', async () => {
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      });

      expect(response).not.toBeNull();
      const result = response!.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe('2025-03-26');
      const capabilities = result.capabilities as Record<string, unknown>;
      const tools = capabilities.tools as Record<string, unknown>;
      expect(tools.listChanged).toBe(true);
      const serverInfo = result.serverInfo as Record<string, unknown>;
      expect(serverInfo.name).toBe('rickydata-agent-proxy');
    });
  });

  describe('tools/list', () => {
    it('returns empty tools when no agents enabled', async () => {
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });

      expect(response).not.toBeNull();
      const result = response!.result as { tools: unknown[] };
      expect(result.tools).toEqual([]);
    });

    it('returns namespaced tools from enabled agents', async () => {
      registry.enableAgent('research-agent');

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Mock initialize response
      const initResult = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'research-agent', version: '1.0.0' },
        },
      };
      // Mock tools/list response
      const toolsResult = {
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [
            { name: 'web_search', description: 'Search the web', inputSchema: { type: 'object' } },
            { name: 'analyze', description: 'Analyze data', inputSchema: { type: 'object' } },
          ],
        },
      };

      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)))
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(toolsResult)));

      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      // Simulate notifications/initialized to trigger tool fetching
      await proxy.handleRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });

      const result = response!.result as { tools: Array<{ name: string; description: string }> };
      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe('research-agent__web_search');
      expect(result.tools[0].description).toContain('[research-agent]');
      expect(result.tools[1].name).toBe('research-agent__analyze');
    });
  });

  describe('tools/call', () => {
    it('routes to the correct agent based on namespace prefix', async () => {
      registry.enableAgent('research-agent');

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      // Initialize + tools/list for the initial refresh
      const initResult = {
        jsonrpc: '2.0', id: 1,
        result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'r', version: '1' } },
      };
      const toolsResult = {
        jsonrpc: '2.0', id: 2,
        result: { tools: [{ name: 'web_search', description: 'Search' }] },
      };

      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(initResult)))
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(toolsResult)));

      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      // Initialize the proxy
      await proxy.handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });

      // Now mock the tool call: init + tools/call
      const callInitResult = {
        jsonrpc: '2.0', id: 3,
        result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'r', version: '1' } },
      };
      const callResult = {
        jsonrpc: '2.0', id: 4,
        result: { content: [{ type: 'text', text: 'Search results for MCP' }] },
      };

      fetchSpy
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(callInitResult)))
        .mockResolvedValueOnce(mockFetchResponse(sseResponse(callResult)));

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'research-agent__web_search',
          arguments: { query: 'MCP servers' },
        },
      });

      expect(response).not.toBeNull();
      const result = response!.result as { content: Array<{ type: string; text: string }> };
      expect(result.content[0].text).toBe('Search results for MCP');

      // Verify the call was routed to the correct agent endpoint
      const lastCallUrl = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][0];
      expect(lastCallUrl).toBe(`${GATEWAY}/agents/research-agent/mcp`);

      // Verify the tool name was stripped of namespace
      const lastCallBody = JSON.parse(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][1]?.body as string);
      expect(lastCallBody.params.name).toBe('web_search');
    });

    it('returns error for unknown tool namespace', async () => {
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'nonexistent__tool', arguments: {} },
      });

      const result = response!.result as { content: Array<{ text: string }>; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });

    it('returns error for tool name without namespace', async () => {
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'no_namespace', arguments: {} },
      });

      const result = response!.result as { content: Array<{ text: string }>; isError: boolean };
      expect(result.isError).toBe(true);
    });
  });

  describe('notifications/initialized', () => {
    it('returns null (notifications have no response)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      // No agents enabled, so no fetches needed
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      expect(response).toBeNull();
    });
  });

  describe('ping', () => {
    it('responds to ping', async () => {
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      });

      expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    });
  });

  describe('unknown method', () => {
    it('returns method not found error', async () => {
      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown/method',
      });

      expect(response!.error).toBeDefined();
      expect(response!.error!.code).toBe(-32601);
    });
  });

  describe('error handling', () => {
    it('skips unreachable agents and continues', async () => {
      registry.enableAgent('good-agent');
      registry.enableAgent('bad-agent');

      // Use URL-based routing since Promise.all causes interleaved fetch calls
      const callCountPerAgent = new Map<string, number>();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('/agents/bad-agent/')) {
          throw new Error('fetch failed');
        }
        // good-agent
        const count = (callCountPerAgent.get('good') ?? 0) + 1;
        callCountPerAgent.set('good', count);
        if (count === 1) {
          return mockFetchResponse(sseResponse({
            jsonrpc: '2.0', id: 1,
            result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'good', version: '1' } },
          }));
        }
        return mockFetchResponse(sseResponse({
          jsonrpc: '2.0', id: 2,
          result: { tools: [{ name: 'tool1', description: 'A tool' }] },
        }));
      });

      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);
      await proxy.handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });

      const result = response!.result as { tools: Array<{ name: string }> };
      // Only good-agent's tools should be present
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('good-agent__tool1');

      stderrSpy.mockRestore();
    });
  });

  describe('multiple agents', () => {
    it('aggregates tools from multiple agents with correct namespacing', async () => {
      registry.enableAgent('agent-a');
      registry.enableAgent('agent-b');

      // Use URL-based routing since Promise.all causes interleaved fetch calls
      const callCountPerAgent = new Map<string, number>();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = String(url);
        const agentId = urlStr.includes('/agents/agent-a/') ? 'agent-a' : 'agent-b';
        const count = (callCountPerAgent.get(agentId) ?? 0) + 1;
        callCountPerAgent.set(agentId, count);

        if (count === 1) {
          // init
          return mockFetchResponse(sseResponse({
            jsonrpc: '2.0', id: 1,
            result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: agentId, version: '1' } },
          }));
        }
        // tools/list
        return mockFetchResponse(sseResponse({
          jsonrpc: '2.0', id: 2,
          result: { tools: [{ name: 'search', description: `Search ${agentId}` }] },
        }));
      });

      const proxy = new AgentMCPProxy(GATEWAY, TOKEN, registry);
      await proxy.handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });

      const response = await proxy.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });

      const result = response!.result as { tools: Array<{ name: string }> };
      expect(result.tools).toHaveLength(2);

      const names = result.tools.map((t) => t.name).sort();
      expect(names).toEqual(['agent-a__search', 'agent-b__search']);
    });
  });
});
