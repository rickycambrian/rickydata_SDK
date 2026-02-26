import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatOutput, formatJson, type OutputFormat } from '../output/formatter.js';
import { CliError, fail } from '../errors.js';
import { CLI_VERSION } from '../version.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

async function listAgentMcpTools(gatewayUrl: string, token: string, agentId: string): Promise<MCPTool[]> {
  // Initialize the agent's MCP endpoint first
  const initRes = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/mcp`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'rickydata-cli', version: CLI_VERSION },
        },
      }),
  });
  if (!initRes.ok) {
    throw new Error(`MCP initialize failed: ${initRes.status} ${await initRes.text()}`);
  }

  // List tools
  const toolsRes = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/mcp`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });
  if (!toolsRes.ok) {
    throw new Error(`MCP tools/list failed: ${toolsRes.status} ${await toolsRes.text()}`);
  }

  // Handle SSE response format
  const contentType = toolsRes.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const text = await toolsRes.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.result?.tools) return json.result.tools;
        } catch { /* continue */ }
      }
    }
    return [];
  }

  const json = await toolsRes.json();
  return json.result?.tools ?? [];
}

async function callAgentMcpTool(
  gatewayUrl: string,
  token: string,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // Initialize first
  const initRes = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/mcp`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'rickydata-cli', version: CLI_VERSION },
      },
    }),
  });
  if (!initRes.ok) {
    throw new Error(`MCP initialize failed: ${initRes.status} ${await initRes.text()}`);
  }

  const callRes = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/mcp`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  if (!callRes.ok) {
    throw new Error(`MCP tools/call failed: ${callRes.status} ${await callRes.text()}`);
  }

  const contentType = callRes.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const text = await callRes.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.result !== undefined) return json.result;
        } catch { /* continue */ }
      }
    }
    return null;
  }

  const json = await callRes.json();
  return json.result;
}

export function createMcpCommands(config: ConfigManager, store: CredentialStore): Command {
  const mcp = new Command('mcp').description("Access an agent's MCP tools directly");

  // mcp tools <agent-id>
  mcp
    .command('tools <agent-id>')
    .description("List an agent's MCP tools")
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const tools = await listAgentMcpTools(gatewayUrl, token, agentId);

        if (format === 'json') {
          console.log(formatJson(tools));
          return;
        }

        if (tools.length === 0) {
          console.log(chalk.yellow('No MCP tools found.'));
          return;
        }

        const rows = tools.map((t) => ({
          name: t.name,
          description: (t.description ?? '').slice(0, 70),
        }));

        console.log(
          formatOutput(rows, [
            { header: 'Tool Name', key: 'name', width: 30 },
            { header: 'Description', key: 'description', width: 72 },
          ], format)
        );
        console.log(chalk.dim(`\n${tools.length} tool(s)`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // mcp call <agent-id> <tool-name> [args-json]
  mcp
    .command('call <agent-id> <tool-name> [args-json]')
    .description('Call an MCP tool on an agent')
    .option('--format <format>', 'Output format (table|json)', 'json')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, toolName: string, argsJson: string | undefined, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      let args: Record<string, unknown> = {};
      if (argsJson) {
        try {
          args = JSON.parse(argsJson);
        } catch {
          fail('Invalid JSON for args. Example: \'{"message": "hello"}\'');
        }
      }

      try {
        const result = await callAgentMcpTool(gatewayUrl, token, agentId, toolName, args);
        console.log(formatJson(result));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return mcp;
}
