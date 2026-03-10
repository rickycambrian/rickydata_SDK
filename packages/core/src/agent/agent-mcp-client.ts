/**
 * Agent MCP Client
 *
 * Connects to an agent's MCP endpoint (Streamable HTTP transport) and
 * exposes standard MCP operations: initialize, tools/list, tools/call.
 *
 * Each agent on the gateway exposes its skills as MCP tools via
 * POST /agents/:id/mcp (JSON-RPC over SSE).
 */

import type {
  AgentMCPClientConfig,
  MCPServerInfo,
  MCPTool,
  MCPToolResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://agents.rickydata.org';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const CLIENT_INFO = { name: 'mcp-gateway-sdk', version: '0.2.0' };

export class AgentMCPClient {
  private readonly baseUrl: string;
  private readonly privateKey: `0x${string}` | null;
  private token: string | null;
  private nextId = 1;

  constructor(config: AgentMCPClientConfig = {}) {
    if (!config.privateKey && !config.token) {
      throw new Error('Either privateKey or token is required');
    }
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.token = config.token ?? null;

    if (config.privateKey) {
      const key = config.privateKey.startsWith('0x')
        ? config.privateKey
        : `0x${config.privateKey}`;
      this.privateKey = key as `0x${string}`;
    } else {
      this.privateKey = null;
    }
  }

  /**
   * Initialize the MCP connection with an agent.
   * Returns server capabilities and protocol version.
   */
  async connect(agentId: string): Promise<MCPServerInfo> {
    if (!agentId) throw new Error('agentId is required');

    const result = await this.sendJsonRpc(agentId, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      clientInfo: CLIENT_INFO,
      capabilities: {},
    });

    return result as MCPServerInfo;
  }

  /**
   * List available MCP tools for an agent.
   * Each tool corresponds to one of the agent's skills that has tool_schema metadata.
   */
  async listTools(agentId: string): Promise<MCPTool[]> {
    if (!agentId) throw new Error('agentId is required');

    const result = await this.sendJsonRpc(agentId, 'tools/list', {});
    return (result as { tools: MCPTool[] }).tools;
  }

  /**
   * Call an MCP tool on an agent.
   * The agent processes the tool call via its skill system and returns the result.
   */
  async callTool(
    agentId: string,
    toolName: string,
    args?: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    if (!agentId) throw new Error('agentId is required');
    if (!toolName) throw new Error('toolName is required');

    const result = await this.sendJsonRpc(agentId, 'tools/call', {
      name: toolName,
      arguments: args ?? {},
    });

    return result as MCPToolResult;
  }

  // ─── Internal: JSON-RPC over SSE ──────────────────────────

  private async sendJsonRpc(
    agentId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureAuthenticated();

    const id = this.nextId++;
    const body = { jsonrpc: '2.0', id, method, params };

    const res = await fetch(
      `${this.baseUrl}/agents/${encodeURIComponent(agentId)}/mcp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MCP request failed: ${res.status} ${text}`);
    }

    // Response is SSE format: "event: message\ndata: {jsonrpc result}\n\n"
    const responseText = await res.text();
    const jsonRpc = parseSSEJsonRpc(responseText);

    if (jsonRpc.error) {
      const err = jsonRpc.error as { code: number; message: string };
      throw new Error(`MCP error ${err.code}: ${err.message}`);
    }

    return jsonRpc.result;
  }

  // ─── Internal: Auth ────────────────────────────────────────

  private async ensureAuthenticated(): Promise<void> {
    if (this.token) return;

    if (!this.privateKey) {
      throw new Error('No token or privateKey available for authentication');
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey);

    // 1. Get challenge
    const challengeRes = await fetch(`${this.baseUrl}/auth/challenge`);
    if (!challengeRes.ok) {
      throw new Error(`Auth challenge failed: ${challengeRes.status}`);
    }
    const { nonce, message: challengeMessage } = await challengeRes.json();

    // 2. Sign challenge
    const signature = await account.signMessage({ message: challengeMessage });

    // 3. Verify
    const verifyRes = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: account.address,
        signature,
        nonce,
      }),
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      throw new Error(`Auth verification failed: ${verifyRes.status} ${body}`);
    }
    const { token } = await verifyRes.json();
    this.token = token;
  }
}

/**
 * Parse an SSE response body to extract the JSON-RPC result.
 *
 * The server sends: `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{...}}\n\n`
 */
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
