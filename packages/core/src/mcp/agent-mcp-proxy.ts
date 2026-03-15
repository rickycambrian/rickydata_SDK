/**
 * Agent MCP Proxy Server
 *
 * A persistent stdio MCP server that aggregates tools from all enabled agents.
 * Watches the agent registry file for changes and sends `notifications/tools/list_changed`
 * to trigger live tool refresh in Claude Code — no restart required.
 *
 * Register with Claude Code using:
 *   claude mcp add --transport stdio rickydata-proxy -- rickydata mcp proxy-server
 *
 * Or via the CLI shortcut:
 *   rickydata mcp proxy-connect
 */

import * as readline from 'readline';
import * as fs from 'fs';
import { AgentRegistry } from './agent-registry.js';
import { AgentError, AgentErrorCode } from '../agent/types.js';

const SERVER_NAME = 'rickydata-agent-proxy';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2025-03-26';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const CLIENT_INFO = { name: 'rickydata-agent-proxy', version: SERVER_VERSION };

// ── JSON-RPC Types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface MCPToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// ── SSE Parsing ─────────────────────────────────────────────────────────────

function parseSSEJsonRpc(body: string): { result?: unknown; error?: unknown } {
  const lines = body.split('\n');
  for (const line of lines) {
    const dataContent = line.startsWith('data: ')
      ? line.slice(6)
      : line.startsWith('data:')
        ? line.slice(5)
        : null;
    if (dataContent) {
      try {
        return JSON.parse(dataContent);
      } catch {
        // Skip non-JSON data lines
      }
    }
  }
  throw new Error('No valid JSON-RPC response found in SSE body');
}

// ── Agent MCP Proxy ─────────────────────────────────────────────────────────

export class AgentMCPProxy {
  private registry: AgentRegistry;
  private watcher: fs.FSWatcher | null = null;
  private toolCache: Map<string, MCPToolDef[]> = new Map(); // agentId → tools
  private initCache: Map<string, number> = new Map(); // agentId → initializedAt timestamp
  private toolCacheTimestamps: Map<string, number> = new Map(); // agentId → tools fetched at timestamp
  private initialized = false;
  private nextId = 1;

  private static readonly INIT_TTL = 600_000; // 10 minutes
  private static readonly TOOL_CACHE_TTL = 300_000; // 5 minutes

  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string,
    registry?: AgentRegistry,
  ) {
    this.registry = registry ?? new AgentRegistry();
  }

  // ── Connection pool ─────────────────────────────────────────────────

  /** Ensure an agent is initialized, reusing cached init if still valid. */
  private async ensureInitialized(agentId: string): Promise<void> {
    const cachedAt = this.initCache.get(agentId);
    if (cachedAt && Date.now() - cachedAt < AgentMCPProxy.INIT_TTL) {
      return;
    }
    await this.sendAgentJsonRpc(agentId, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: CLIENT_INFO,
      capabilities: {},
    });
    this.initCache.set(agentId, Date.now());
  }

  // ── Tool fetching ───────────────────────────────────────────────────

  /** Send a JSON-RPC request to an agent's MCP endpoint. */
  private async sendAgentJsonRpc(
    agentId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;
    const body = { jsonrpc: '2.0', id, method, params };

    const res = await fetch(
      `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/mcp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw AgentError.fromHttpStatus(res.status, text, { agentId, operation: method });
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const responseText = await res.text();
      const jsonRpc = parseSSEJsonRpc(responseText);
      if (jsonRpc.error) {
        const err = jsonRpc.error as { code: number; message: string };
        throw new AgentError(AgentErrorCode.TOOL_ERROR, `MCP error ${err.code}: ${err.message}`, { agentId, operation: method });
      }
      return jsonRpc.result;
    }

    const json = await res.json();
    if (json.error) {
      throw new AgentError(AgentErrorCode.TOOL_ERROR, `MCP error ${json.error.code}: ${json.error.message}`, { agentId, operation: method });
    }
    return json.result;
  }

  /** Fetch tools for a single agent, returning them with namespaced names. */
  private async fetchAgentTools(agentId: string): Promise<MCPToolDef[]> {
    try {
      // Return cached tools if still within TTL
      const cachedAt = this.toolCacheTimestamps.get(agentId);
      const cachedTools = this.toolCache.get(agentId);
      if (cachedAt && cachedTools && Date.now() - cachedAt < AgentMCPProxy.TOOL_CACHE_TTL) {
        return cachedTools;
      }

      // Ensure the agent's MCP endpoint is initialized (connection pool)
      await this.ensureInitialized(agentId);

      // List tools
      const result = (await this.sendAgentJsonRpc(agentId, 'tools/list', {})) as {
        tools: MCPToolDef[];
      };

      // Namespace tools: {agent-slug}__{tool_name}
      const slug = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const namespacedTools = (result.tools ?? []).map((t) => ({
        ...t,
        name: `${slug}__${t.name}`,
        description: t.description
          ? `[${agentId}] ${t.description}`
          : `[${agentId}]`,
      }));

      // Record fetch timestamp for TTL
      this.toolCacheTimestamps.set(agentId, Date.now());

      return namespacedTools;
    } catch (err) {
      if (err instanceof AgentError) {
        switch (err.code) {
          case AgentErrorCode.AUTH_EXPIRED:
            console.error(`[proxy] Auth expired for agent "${agentId}": ${err.message}`);
            break;
          case AgentErrorCode.NOT_FOUND:
            console.error(`[proxy] Agent "${agentId}" not found, removing from cache`);
            this.toolCache.delete(agentId);
            break;
          default:
            console.error(`[proxy] Failed to fetch tools for agent "${agentId}" [${err.code}]: ${err.message}`);
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[proxy] Failed to fetch tools for agent "${agentId}": ${message}`);
      }
      return [];
    }
  }

  /** Fetch tools for all enabled agents and update the cache. Returns true if tools changed. */
  private async refreshAllTools(): Promise<boolean> {
    const agents = this.registry.listAgents();
    const oldTools = this.getAggregatedToolNames();

    // Fetch all agent tools in parallel
    const results = await Promise.all(
      agents.map(async (a) => {
        const tools = await this.fetchAgentTools(a.agentId);
        return { agentId: a.agentId, tools };
      }),
    );

    // Update cache
    // Remove agents that are no longer enabled
    const enabledIds = new Set(agents.map((a) => a.agentId));
    for (const key of this.toolCache.keys()) {
      if (!enabledIds.has(key)) this.toolCache.delete(key);
    }
    // Set new tools
    for (const { agentId, tools } of results) {
      this.toolCache.set(agentId, tools);
    }

    const newTools = this.getAggregatedToolNames();
    return oldTools !== newTools;
  }

  /** Get a stable string of all tool names for diffing. */
  private getAggregatedToolNames(): string {
    const names: string[] = [];
    for (const tools of this.toolCache.values()) {
      for (const t of tools) names.push(t.name);
    }
    return names.sort().join(',');
  }

  /** Get all aggregated tools from the cache. */
  private getAggregatedTools(): MCPToolDef[] {
    const all: MCPToolDef[] = [];
    for (const tools of this.toolCache.values()) {
      all.push(...tools);
    }
    return all;
  }

  // ── Tool call routing ───────────────────────────────────────────────

  /** Parse a namespaced tool name into agentId and original tool name. */
  private parseToolName(namespacedName: string): { agentId: string; toolName: string } | null {
    const idx = namespacedName.indexOf('__');
    if (idx === -1) return null;

    const slug = namespacedName.slice(0, idx);
    const toolName = namespacedName.slice(idx + 2);

    // Find the agent whose slug matches
    for (const agentId of this.toolCache.keys()) {
      const agentSlug = agentId.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (agentSlug === slug) {
        return { agentId, toolName };
      }
    }

    return null;
  }

  /** Call a tool on the correct agent. */
  private async callTool(
    namespacedName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const parsed = this.parseToolName(namespacedName);
    if (!parsed) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${namespacedName}` }) }],
        isError: true,
      };
    }

    try {
      // Ensure initialized (connection pool), then call
      await this.ensureInitialized(parsed.agentId);

      const result = await this.sendAgentJsonRpc(parsed.agentId, 'tools/call', {
        name: parsed.toolName,
        arguments: args,
      });

      return result as MCPToolResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }

  // ── Stdio JSON-RPC ──────────────────────────────────────────────────

  /** Send a JSON-RPC notification to stdout (no id field). */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };
    process.stdout.write(JSON.stringify(notification) + '\n');
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    // Notifications (no id) don't get responses
    if (id === undefined || id === null) {
      if (request.method === 'notifications/initialized') {
        this.initialized = true;

        // Fetch initial tools and start watching
        try {
          await this.refreshAllTools();
        } catch (err) {
          console.error(`[proxy] Error fetching initial tools: ${err}`);
        }
        this.startWatching();
      }
      return null;
    }

    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: true },
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION,
            },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getAggregatedTools().map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };

      case 'tools/call': {
        const params = request.params ?? {};
        const toolName = params.name as string;
        const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

        const result = await this.callTool(toolName, toolArgs);
        return { jsonrpc: '2.0', id, result };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  }

  /** Start watching the registry file for changes. */
  private startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = this.registry.watch(async () => {
        console.error('[proxy] Registry changed, refreshing tools...');
        // Invalidate connection pool and tool cache so refreshAllTools() re-fetches everything
        this.initCache.clear();
        this.toolCacheTimestamps.clear();
        try {
          const changed = await this.refreshAllTools();
          if (changed) {
            console.error('[proxy] Tools changed, sending notification');
            this.sendNotification('notifications/tools/list_changed');
          } else {
            console.error('[proxy] No tool changes detected');
          }
        } catch (err) {
          console.error(`[proxy] Error refreshing tools: ${err}`);
        }
      });
    } catch (err) {
      console.error(`[proxy] Failed to watch registry: ${err}`);
    }
  }

  /**
   * Run the proxy server on stdio, reading JSON-RPC messages line by line.
   */
  async run(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
        continue;
      }

      try {
        const response = await this.handleRequest(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err) {
        console.error(`[proxy] Unhandled error processing request: ${err}`);
        if (request.id !== undefined && request.id !== null) {
          const errorResponse: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32603, message: 'Internal error' },
          };
          process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    }

    // Cleanup on exit
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

/**
 * Start the agent MCP proxy server using stored credentials.
 */
export async function startAgentMCPProxy(
  gatewayUrl: string,
  token: string,
  registry?: AgentRegistry,
): Promise<void> {
  const proxy = new AgentMCPProxy(gatewayUrl, token, registry);
  await proxy.run();
}
