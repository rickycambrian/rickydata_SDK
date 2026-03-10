/**
 * Canvas Workflow MCP Server
 *
 * A standalone MCP server that exposes canvas workflow operations as tools
 * over JSON-RPC via stdio. Register with Claude Code using:
 *
 *   claude mcp add --transport stdio canvas-workflows rickydata mcp canvas-server
 *
 * Or run directly:
 *
 *   rickydata mcp canvas-server
 *
 * Authentication: Uses the stored wallet token from `rickydata auth login`.
 * The server reads credentials from ~/.rickydata/credentials.json.
 */

import * as readline from 'readline';
import { CanvasClient } from '../canvas/canvas-client.js';
import { AuthManager } from '../auth.js';
import { createCanvasTools, type CanvasMCPTool, type MCPToolResponse } from './canvas-tools.js';

const SERVER_NAME = 'rickydata-canvas-mcp';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2025-03-26';

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

// ── MCP Server ──────────────────────────────────────────────────────────────

export class CanvasMCPServer {
  private client: CanvasClient | null = null;
  private tools: CanvasMCPTool[];
  private initialized = false;

  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string,
  ) {
    this.tools = createCanvasTools();
  }

  private ensureClient(): CanvasClient {
    if (!this.client) {
      const auth = new AuthManager(this.gatewayUrl, this.token);
      this.client = new CanvasClient({ baseUrl: this.gatewayUrl, auth });
    }
    return this.client;
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const id = request.id ?? null;

    // Notifications (no id) don't get responses
    if (id === undefined || id === null) {
      // Handle initialized notification silently
      if (request.method === 'notifications/initialized') {
        this.initialized = true;
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
              tools: { listChanged: false },
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
            tools: this.tools.map((t) => ({
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

        const tool = this.tools.find((t) => t.name === toolName);
        if (!tool) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${toolName}` }) }],
              isError: true,
            } satisfies MCPToolResponse,
          };
        }

        try {
          const client = this.ensureClient();
          const result = await tool.handler(toolArgs, client);
          return { jsonrpc: '2.0', id, result };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
              isError: true,
            } satisfies MCPToolResponse,
          };
        }
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

  /**
   * Run the MCP server on stdio, reading JSON-RPC messages line by line.
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

      const response = await this.handleRequest(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    }
  }
}

/**
 * Start the canvas MCP server using stored credentials.
 *
 * @param gatewayUrl - Agent Gateway URL (default: https://agents.rickydata.org)
 * @param token - Wallet token for authentication
 */
export async function startCanvasMCPServer(
  gatewayUrl: string,
  token: string,
): Promise<void> {
  const server = new CanvasMCPServer(gatewayUrl, token);
  await server.run();
}
