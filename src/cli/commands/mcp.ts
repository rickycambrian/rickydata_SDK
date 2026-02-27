import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatOutput, formatJson, type OutputFormat } from '../output/formatter.js';
import { CliError, fail } from '../errors.js';
import { CLI_VERSION } from '../version.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';

// ── Helpers ──────────────────────────────────────────────────────────

function mcpHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Send a JSON-RPC request to the MCP gateway. Returns the parsed JSON-RPC result. */
async function mcpRequest(
  mcpUrl: string,
  method: string,
  params: Record<string, unknown>,
  id: number,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  if (!res.ok) {
    throw new Error(`MCP ${method} failed: ${res.status} ${await res.text()}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6));
          if (json.result !== undefined) return json.result;
          if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
        } catch (e) { if (e instanceof Error && e.message.includes('MCP')) throw e; }
      }
    }
    throw new Error(`No result in SSE response for ${method}`);
  }
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

/** Initialize an MCP session (required before tools/list or tools/call). */
async function mcpInitialize(mcpUrl: string, headers: Record<string, string>): Promise<void> {
  await mcpRequest(mcpUrl, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'rickydata-cli', version: CLI_VERSION },
  }, 1, headers);
}

/** Call a meta-tool via MCP tools/call. */
async function mcpCallMetaTool(
  mcpUrl: string,
  headers: Record<string, string>,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  await mcpInitialize(mcpUrl, headers);
  const result = await mcpRequest(mcpUrl, 'tools/call', { name: toolName, arguments: args }, 2, headers);
  return result;
}

/** Parse the text content from an MCP tool result. */
function extractResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return JSON.stringify(result);
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (Array.isArray(r.content)) {
    return r.content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('\n');
  }
  return JSON.stringify(result);
}

function parseResultJson(result: unknown): unknown {
  const text = extractResultText(result);
  try { return JSON.parse(text); } catch { return text; }
}

// ── Agent MCP helpers (kept from original) ───────────────────────────

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

// ── x402 Payment Helper ──────────────────────────────────────────────

const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
const BASE_CHAIN_ID = 8453;

/** Returns USDC balance in base units (6 decimals) for the given address on Base mainnet. */
async function checkUsdcBalance(address: string): Promise<bigint> {
  const { createPublicClient, http } = await import('viem');
  const { base } = await import('viem/chains');

  const client = createPublicClient({ chain: base, transport: http() });
  return client.readContract({
    address: USDC_CONTRACT,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
  });
}

interface PaymentInfo {
  amount: string;
  paid: boolean;
}

async function mcpCallWithPayment(
  mcpUrl: string,
  token: string | undefined,
  privateKey: string | undefined,
  toolName: string,
  args: Record<string, unknown>,
  onColdStartRetry?: () => void,
): Promise<{ result: unknown; payment?: PaymentInfo }> {
  const headers = mcpHeaders(token);

  // Initialize
  await mcpInitialize(mcpUrl, headers);

  // Try the call
  const result = await mcpRequest(mcpUrl, 'tools/call', { name: toolName, arguments: args }, 3, headers);

  // Check if the result indicates payment required
  const parsed = parseResultJson(result);
  if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).error === 'PAYMENT_REQUIRED') {
    const pr = (parsed as Record<string, unknown>).paymentRequirements as Record<string, unknown> | undefined;
    if (!pr) throw new CliError('Payment required but no payment requirements returned');

    if (!privateKey) {
      throw new CliError(
        'Payment required ($' + (pr.priceUsd || '0.0005') + ' USDC). ' +
        'Run `rickydata auth login --private-key 0x...` to enable x402 payments.'
      );
    }

    // Sign payment
    const { privateKeyToAccount } = await import('viem/accounts');
    const { signPayment } = await import('../../payment/payment-signer.js');

    const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(key as `0x${string}`);

    // Check USDC balance before signing
    const requiredAmount = BigInt(String(pr.maxAmountRequired || Math.floor(parseFloat(String(pr.priceUsd || '0.0005')) * 1_000_000)));
    const balance = await checkUsdcBalance(account.address);
    if (balance < requiredAmount) {
      const balanceUsd = (Number(balance) / 1_000_000).toFixed(6);
      const requiredUsd = (Number(requiredAmount) / 1_000_000).toFixed(6);
      throw new CliError(
        `Insufficient USDC balance. Have $${balanceUsd}, need $${requiredUsd} on Base mainnet.\n` +
        `Deposit USDC to your wallet: ${account.address}`
      );
    }

    const paymentReqs = {
      amount: String(requiredAmount),
      recipient: pr.payTo as string,
      usdcContract: (pr.asset as string) || USDC_CONTRACT,
      network: `eip155:${BASE_CHAIN_ID}`,
      chainId: BASE_CHAIN_ID,
    };

    const { header } = await signPayment(account, paymentReqs);

    // Retry with payment header
    const paidHeaders = { ...headers, 'X-Payment': header };
    // Need to re-initialize with payment headers
    await mcpInitialize(mcpUrl, paidHeaders);
    let paidResult = await mcpRequest(mcpUrl, 'tools/call', { name: toolName, arguments: args }, 4, paidHeaders);

    // Cold-start retry: if the server timed out during spin-up, wait and retry once
    if (isColdStartError(paidResult)) {
      onColdStartRetry?.();
      await new Promise(resolve => setTimeout(resolve, 10_000));
      await mcpInitialize(mcpUrl, paidHeaders);
      paidResult = await mcpRequest(mcpUrl, 'tools/call', { name: toolName, arguments: args }, 5, paidHeaders);
    }

    return {
      result: paidResult,
      payment: {
        amount: String(pr.priceUsd || '$0.0005'),
        paid: true,
      },
    };
  }

  // Cold-start retry for free calls too
  if (isColdStartError(result)) {
    onColdStartRetry?.();
    await new Promise(resolve => setTimeout(resolve, 10_000));
    await mcpInitialize(mcpUrl, headers);
    const retried = await mcpRequest(mcpUrl, 'tools/call', { name: toolName, arguments: args }, 4, headers);
    return { result: retried };
  }

  return { result };
}

/** Returns true if a tool result indicates a server cold-start timeout. */
function isColdStartError(result: unknown): boolean {
  const text = extractResultText(result).toLowerCase();
  return text.includes('connection closed') || text.includes('timeout');
}

/** Returns a user-friendly error message with actionable next steps. */
function classifyMcpError(err: unknown, context: 'search' | 'enable' | 'disable' | 'tools' | 'call' | 'info'): string {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return `Authentication failed. Run \`rickydata auth login\` and try again.\n  ${msg}`;
  }
  if (lower.includes('403') || lower.includes('forbidden')) {
    return `Access denied. Your token may have expired — run \`rickydata auth login\` to refresh.\n  ${msg}`;
  }
  if (lower.includes('404') || lower.includes('not found')) {
    if (context === 'enable' || context === 'disable' || context === 'info') {
      return `Server not found. Use \`rickydata mcp search <name>\` to find the correct name or ID.\n  ${msg}`;
    }
    if (context === 'call') {
      return `Tool not found. Use \`rickydata mcp tools\` to list available tools.\n  ${msg}`;
    }
  }
  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('network')) {
    return `Cannot reach MCP gateway. Check your connection or run \`rickydata auth status\` to verify the gateway URL.\n  ${msg}`;
  }
  if (lower.includes('secrets') || lower.includes('needs_secrets') || lower.includes('api key')) {
    return `This server requires secrets. Configure them at https://mcpmarketplace.rickydata.org and try again.\n  ${msg}`;
  }
  return msg;
}

// ── Command Builder ──────────────────────────────────────────────────

export function createMcpCommands(config: ConfigManager, store: CredentialStore): Command {
  const mcp = new Command('mcp').description('MCP gateway tools — search, enable, and call MCP server tools');

  // ── mcp search <query> ────────────────────────────────────────────
  mcp
    .command('search <query>')
    .description('Search available MCP servers')
    .option('--limit <n>', 'Max results', '20')
    .option('--category <cat>', 'Filter by category')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile')
    .action(async (query: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '') + '/mcp';
      const token = store.getToken(profile)?.token;
      const format = opts.format as OutputFormat;

      try {
        const result = await mcpCallMetaTool(mcpUrl, mcpHeaders(token), 'gateway__search_servers', {
          query,
          limit: parseInt(opts.limit),
          ...(opts.category ? { category: opts.category } : {}),
        });

        const data = parseResultJson(result) as Record<string, unknown> | null;
        if (!data || !Array.isArray((data as Record<string, unknown>).servers)) {
          console.log(chalk.yellow('No results'));
          return;
        }

        if (format === 'json') {
          console.log(formatJson(data));
          return;
        }

        const servers = data.servers as Array<Record<string, unknown>>;
        const rows = servers.map((s) => ({
          name: String(s.name || s.title || ''),
          tools: String(s.toolsCount ?? 0),
          categories: (Array.isArray(s.categories) ? s.categories : []).join(', '),
          score: s.securityScore != null ? String(s.securityScore) : '-',
          id: String(s.id || ''),
        }));

        console.log(
          formatOutput(rows, [
            { header: 'Name', key: 'name', width: 35 },
            { header: 'Tools', key: 'tools', width: 7 },
            { header: 'Categories', key: 'categories', width: 25 },
            { header: 'Score', key: 'score', width: 7 },
            { header: 'ID', key: 'id', width: 38 },
          ], format)
        );
        console.log(chalk.dim(`\nShowing ${data.showing} of ${data.total} servers`));
      } catch (err) {
        throw new CliError(classifyMcpError(err, 'search'));
      }
    });

  // ── mcp enable <name-or-id> ───────────────────────────────────────
  mcp
    .command('enable <name-or-id>')
    .description('Enable an MCP server by name or ID')
    .option('--profile <profile>', 'Config profile')
    .action(async (nameOrId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '') + '/mcp';
      const token = store.getToken(profile)?.token;
      if (!token) fail('Not authenticated. Run `rickydata auth login` first.');

      const spinner = ora('Enabling server...').start();
      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
        const args = isUUID
          ? { server_id: nameOrId }
          : { server_name: nameOrId };

        const result = await mcpCallMetaTool(mcpUrl, mcpHeaders(token), 'gateway__enable_server', args);
        const data = parseResultJson(result) as Record<string, unknown> | null;

        if (data && data.enabled) {
          const server = data.server as Record<string, unknown> | undefined;
          spinner.succeed(chalk.green(`${server?.title || nameOrId} enabled (${server?.toolsCount || '?'} tools)`));
        } else {
          spinner.fail(chalk.red(extractResultText(result)));
        }
      } catch (err) {
        spinner.fail(chalk.red('Failed to enable server'));
        throw new CliError(classifyMcpError(err, 'enable'));
      }
    });

  // ── mcp disable <name-or-id> ──────────────────────────────────────
  mcp
    .command('disable <name-or-id>')
    .description('Disable a previously enabled MCP server')
    .option('--profile <profile>', 'Config profile')
    .action(async (nameOrId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '') + '/mcp';
      const token = store.getToken(profile)?.token;
      if (!token) fail('Not authenticated. Run `rickydata auth login` first.');

      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
        const args = isUUID
          ? { server_id: nameOrId }
          : { server_name: nameOrId };

        const result = await mcpCallMetaTool(mcpUrl, mcpHeaders(token), 'gateway__disable_server', args);
        const data = parseResultJson(result) as Record<string, unknown> | null;

        if (data && data.disabled) {
          console.log(chalk.green('✓ Server disabled'));
        } else {
          console.log(chalk.red(extractResultText(result)));
        }
      } catch (err) {
        throw new CliError(classifyMcpError(err, 'disable'));
      }
    });

  // ── mcp tools ─────────────────────────────────────────────────────
  mcp
    .command('tools')
    .description('List tools from enabled servers')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '') + '/mcp';
      const token = store.getToken(profile)?.token;
      if (!token) fail('Not authenticated. Run `rickydata auth login` first.');
      const format = opts.format as OutputFormat;

      try {
        const headers = mcpHeaders(token);
        await mcpInitialize(mcpUrl, headers);
        const result = await mcpRequest(mcpUrl, 'tools/list', {}, 2, headers) as { tools?: MCPTool[] };
        const tools = result?.tools ?? [];

        // Filter out meta-tools (gateway__*)
        const serverTools = tools.filter(t => !t.name.startsWith('gateway__'));

        if (format === 'json') {
          console.log(formatJson(serverTools));
          return;
        }

        if (serverTools.length === 0) {
          console.log(chalk.yellow('No server tools enabled. Use `rickydata mcp search` and `rickydata mcp enable` first.'));
          return;
        }

        const rows = serverTools.map(t => ({
          name: t.name,
          description: (t.description ?? '').slice(0, 60),
        }));

        console.log(
          formatOutput(rows, [
            { header: 'Tool Name', key: 'name', width: 45 },
            { header: 'Description', key: 'description', width: 62 },
          ], format)
        );
        console.log(chalk.dim(`\n${serverTools.length} tool(s) from enabled servers`));
      } catch (err) {
        throw new CliError(classifyMcpError(err, 'tools'));
      }
    });

  // ── mcp call <tool-name> [args-json] ──────────────────────────────
  mcp
    .command('call <tool-name> [args-json]')
    .description('Call an MCP tool (auto-pays x402 if required)')
    .option('--format <format>', 'Output format', 'json')
    .option('--profile <profile>', 'Config profile')
    .action(async (toolName: string, argsJson: string | undefined, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '') + '/mcp';
      const cred = store.getToken(profile);
      const token = cred?.token;
      const privateKey = store.getPrivateKey(profile) ?? undefined;

      let args: Record<string, unknown> = {};
      if (argsJson) {
        try {
          args = JSON.parse(argsJson);
        } catch {
          fail('Invalid JSON for args. Example: \'{"query": "hello"}\'');
        }
      }

      let retrySpinner: ReturnType<typeof ora> | undefined;
      const onColdStartRetry = () => {
        retrySpinner = ora('Server is starting up, retrying in 10s...').start();
      };

      try {
        const { result, payment } = await mcpCallWithPayment(mcpUrl, token, privateKey, toolName, args, onColdStartRetry);

        retrySpinner?.succeed('Server ready, got result');

        if (payment?.paid) {
          console.log(chalk.green(`Paid $${payment.amount} USDC`));
        }

        const text = extractResultText(result);
        try {
          console.log(formatJson(JSON.parse(text)));
        } catch {
          console.log(text);
        }
      } catch (err) {
        retrySpinner?.fail('Retry failed');
        throw new CliError(classifyMcpError(err, 'call'));
      }
    });

  // ── mcp info <name-or-id> ─────────────────────────────────────────
  mcp
    .command('info <name-or-id>')
    .description('Get detailed server information')
    .option('--format <format>', 'Output format', 'json')
    .option('--profile <profile>', 'Config profile')
    .action(async (nameOrId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '') + '/mcp';
      const token = store.getToken(profile)?.token;

      try {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
        const args = isUUID
          ? { server_id: nameOrId }
          : { server_name: nameOrId };

        const result = await mcpCallMetaTool(mcpUrl, mcpHeaders(token), 'gateway__server_info', args);
        const data = parseResultJson(result);
        console.log(formatJson(data));
      } catch (err) {
        throw new CliError(classifyMcpError(err, 'info'));
      }
    });

  // ── mcp connect ───────────────────────────────────────────────────
  mcp
    .command('connect')
    .description('Print the claude mcp add command for connecting')
    .option('--profile <profile>', 'Config profile')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '');
      const cred = store.getToken(profile);

      console.log(chalk.cyan('Add MCP Gateway to Claude Code:\n'));
      if (cred?.token) {
        console.log(`  claude mcp add --transport http \\`);
        console.log(`    --header "Authorization:Bearer ${cred.token}" \\`);
        console.log(`    mcp-gateway ${mcpUrl}/mcp`);
      } else {
        console.log(`  claude mcp add --transport http mcp-gateway ${mcpUrl}/mcp`);
      }
      console.log();
    });

  // ── mcp agent (subcommand group for existing agent-MCP) ───────────
  const agent = new Command('agent').description('Agent MCP tools (via agent gateway)');

  function requireAuth(profile: string): string {
    const cred = store.getToken(profile);
    if (!cred) fail('Not authenticated. Run `rickydata auth login` first.');
    return cred.token;
  }

  agent
    .command('tools <agent-id>')
    .description("List an agent's MCP tools")
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(profile);
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
        throw new CliError(classifyMcpError(err, 'tools'));
      }
    });

  agent
    .command('call <agent-id> <tool-name> [args-json]')
    .description('Call an MCP tool on an agent')
    .option('--format <format>', 'Output format (table|json)', 'json')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, toolName: string, argsJson: string | undefined, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(profile);

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
        throw new CliError(classifyMcpError(err, 'call'));
      }
    });

  mcp.addCommand(agent);

  return mcp;
}
