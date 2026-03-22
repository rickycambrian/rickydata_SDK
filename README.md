# rickydata

TypeScript SDK and CLI for the [MCP Gateway](https://mcp.rickydata.org) — search 5,000+ MCP servers, enable tools, and use them in Claude Code or any MCP client.

## Get Started

```bash
npm install -g rickydata
rickydata init
```

The wizard walks you through sign-in, connecting to Claude Code, and verifying everything works. Restart Claude Code when it tells you to — you'll have 5,000+ MCP tools available.

<details>
<summary>Or do it manually (3 commands)</summary>

```bash
rickydata auth login       # Sign in via browser
rickydata mcp connect      # Connect to Claude Code
# Restart Claude Code
```
</details>

## What You Can Do in Claude Code

Once connected, Claude Code has these meta-tools:

- **`gateway__search_servers`** — search the marketplace by name or category
- **`gateway__enable_server`** — enable a server to use its tools
- **`gateway__disable_server`** — disable a server
- **`gateway__list_enabled`** — see your currently enabled servers
- **`gateway__server_info`** — get details about a specific server

Just ask Claude things like:
- "Search for a Brave search MCP server and enable it"
- "Find a tool that can search arXiv papers"
- "What servers do I have enabled?"

Once a server is enabled, its tools appear and Claude can call them directly.

## CLI Quick Reference

```bash
# Search the marketplace (no auth needed)
rickydata mcp search "brave"

# Enable/disable servers
rickydata mcp enable brave-search-mcp-server
rickydata mcp disable brave-search-mcp-server

# List your enabled tools
rickydata mcp tools

# Call a tool directly from the CLI
rickydata mcp call blazickjp-arxiv-mcp-server__search_papers '{"query":"transformers","max_results":3}'

# Check auth status and wallet balance
rickydata auth status
rickydata wallet balance
```

## Agent Chat (BYOK)

Chat with AI agents that have access to MCP tools. Requires your own Anthropic API key.

```bash
rickydata apikey set         # Store your sk-ant-... key
rickydata agents list        # List available agents
rickydata chat <agent-id>    # Start chatting
```

Cost: 10% platform markup on Anthropic LLM cost + $0.0005 per MCP tool call.

## Canvas Workflows

Build and execute visual workflow DAGs that chain agents, MCP tools, approval gates, and GitHub actions.

### CLI

```bash
# List saved workflows
rickydata canvas list

# Execute a workflow (streams progress in real-time)
rickydata canvas execute <entity-id>
rickydata canvas execute ./my-workflow.canvas.json --verbose

# Check run history
rickydata canvas runs
rickydata canvas run <run-id>

# Import/export portable .canvas.json files
rickydata canvas import ./workflow.canvas.json
rickydata canvas export <entity-id> --output ./backup.canvas.json
```

### Claude Code Integration (MCP Server)

Register the canvas MCP server to give Claude Code 7 canvas workflow tools:

```bash
claude mcp add --transport stdio canvas-workflows rickydata mcp canvas-server
```

Available tools: `canvas_list_workflows`, `canvas_get_workflow`, `canvas_execute_workflow`, `canvas_execute_workflow_from_json`, `canvas_list_runs`, `canvas_get_run`, `canvas_save_workflow`.

### SDK

```typescript
import { CanvasClient, AuthManager } from 'rickydata';

const auth = new AuthManager('https://agents.rickydata.org', 'mcpwt_...');
const canvas = new CanvasClient({ auth });

// List saved workflows
const workflows = await canvas.listWorkflows();

// Execute with SSE streaming
for await (const event of canvas.executeWorkflow({ nodes, connections })) {
  console.log(event.type, event.data);
}

// Or wait for the final result
const result = await canvas.executeWorkflowSync({ nodes, connections });
console.log(result.status, result.results);
```

---

<details>
<summary><b>Authentication Details</b></summary>

### Browser Login (Recommended)

```bash
rickydata auth login
```

Opens your browser to sign in with email, Google, GitHub, Discord, or any Web3 wallet. Produces a `mcpwt_` wallet token valid for 30 days that works with both the MCP Gateway and Agent Gateway.

### Other Methods

| Method | Command | When to Use |
|--------|---------|-------------|
| Browser login | `rickydata auth login` | Default — works for everyone |
| Direct token | `rickydata auth login --token mcpwt_...` | Paste a token from another source |
| Private key | `rickydata auth login --private-key 0x...` | Advanced/self-custody x402 signing |

### Connecting to Claude Code

`rickydata init` and `rickydata mcp connect` both auto-run `claude mcp add` with the correct URL and your auth token. Use `--dry-run` to see the command without executing:

```bash
rickydata mcp connect --dry-run
```

Manual alternative:

```bash
claude mcp add --transport http mcp-gateway https://mcp.rickydata.org/mcp \
  --header "Authorization:Bearer YOUR_TOKEN"
```

</details>

<details>
<summary><b>Wallet & Payments</b></summary>

All payments use **USDC on Base mainnet** (Chain 8453).

| Action | Cost |
|--------|------|
| MCP tool call (default token flow) | $0.0005 USDC (managed relay + wallet top-up) |
| MCP tool call (self-custody mode) | $0.0005 USDC (private-key signing) |
| Agent chat | 10% markup on LLM cost |
| Browsing / searching / tools/list | Free |

### Funding Your Wallet

```bash
rickydata wallet balance   # Shows deposit address
```

Send USDC on Base mainnet to the address shown. Or use the web interface at https://marketplace.rickydata.org/#/wallet.

</details>

<details>
<summary><b>Full CLI Command Tree</b></summary>

```
rickydata
├── init               Setup wizard (auth + connect + verify)
├── auth
│   ├── login          Log in via browser, token, or private key
│   ├── status         Show auth status, token type, expiry, balance
│   ├── logout         Clear stored credentials
│   └── token
│       └── create     Generate a wallet token (long-lived)
├── mcp
│   ├── search <query> Search marketplace servers
│   ├── enable <name>  Enable a server (requires auth)
│   ├── disable <name> Disable a server (requires auth)
│   ├── tools          List tools from enabled servers
│   ├── call <tool>    Call a tool directly
│   ├── info <name>    Get server details
│   ├── status         Show MCP connection status
│   ├── connect        Add MCP Gateway to Claude Code
│   └── agent
│       ├── tools <id> List an agent's MCP tools
│       └── call <id>  Call an MCP tool on an agent
├── agents
│   ├── list           List available agents
│   └── describe <id>  Show agent details
├── canvas
│   ├── list           List saved workflows
│   ├── execute <id>   Execute by entity ID or local .json file
│   ├── runs           List recent execution runs
│   ├── run <id>       Show run details
│   ├── import <file>  Import a .canvas.json file
│   └── export <id>    Export workflow to .canvas.json
├── chat <agent-id>    Interactive agent chat (requires BYOK)
├── sessions
│   ├── list / get / resume / delete
├── wallet
│   ├── balance        Show USDC balance and deposit address
│   ├── transactions   List recent transactions
│   └── settings       Show / set wallet settings
├── apikey
│   ├── set / status / delete
└── config
    ├── set / get / list / activate / profiles
```

### Chat REPL Slash Commands

Inside `rickydata chat`:
- `/session` — show current session ID
- `/model <name>` — switch model (`haiku`, `sonnet`, `opus`)
- `/cost` — show accumulated session cost
- `/exit` — exit chat

</details>

---

## SDK Usage (TypeScript)

For building applications that programmatically interact with the MCP Gateway.

### Browse Servers

```typescript
import { MCPGateway } from 'rickydata';

const gw = new MCPGateway({ url: 'https://mcp.rickydata.org' });
const servers = await gw.listServers();
```

### Call Tools with x402 Payments

Hybrid model:
- Default: wallet token (`mcpwt_...`) + managed relay (no private key required).
- Advanced: self-custody signing with `SpendingWallet`.

```typescript
import { MCPGateway, SpendingWallet } from 'rickydata';
import { privateKeyToAccount } from 'viem/accounts';

const wallet = await SpendingWallet.fromPrivateKey(process.env.PRIVATE_KEY!, {
  maxPerCall: 0.01, maxPerDay: 5.0,
});

const gw = new MCPGateway({ url: 'https://mcp.rickydata.org', spendingWallet: wallet });
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
await gw.authenticateAuto({
  signFn: (message) => account.signMessage({ message }),
  walletAddress: account.address,
});

const result = await gw.callTool(serverId, 'brave_web_search', { query: 'MCP' });
wallet.destroy();
```

### Agent Chat

```typescript
import { A2AClient } from 'rickydata/a2a';

const client = new A2AClient({ baseUrl: 'https://agents.rickydata.org', token: 'mcpwt_...' });
await client.storeApiKey('sk-ant-...');
const task = await client.sendMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Research MCP protocol' }] },
  metadata: { agentId: 'research-agent' },
});
```

### Canvas Workflow Execution

```typescript
import { CanvasClient, AuthManager } from 'rickydata';

const auth = new AuthManager('https://agents.rickydata.org', 'mcpwt_...');
const canvas = new CanvasClient({ auth });

// Stream execution events
for await (const event of canvas.executeWorkflow({
  nodes: [
    { id: 'input', type: 'textInputNode', data: { value: 'Summarize MCP protocol' } },
    { id: 'agent', type: 'agentNode', data: { prompt: 'Summarize the input', model: 'haiku' } },
    { id: 'output', type: 'resultsNode', data: {} },
  ],
  connections: [
    { source: 'input', target: 'agent' },
    { source: 'agent', target: 'output' },
  ],
})) {
  if (event.type === 'node_completed') console.log(`${event.data.nodeId}: done`);
  if (event.type === 'run_completed') console.log('Results:', event.data.results);
}
```

### Agent as MCP Server

```typescript
import { AgentMCPClient } from 'rickydata';

const client = new AgentMCPClient({ token: 'mcpwt_...' });
const info = await client.connect('research-agent');
const tools = await client.listTools('research-agent');
const result = await client.callTool('research-agent', 'web_research', { topic: 'MCP' });
```

<details>
<summary><b>SDK API Reference</b></summary>

### MCPGateway

| Method | Description |
|--------|-------------|
| `listServers(opts?)` | List servers (filter by registry, type, compatibility) |
| `getServer(id)` | Get server details |
| `searchServers(query)` | Search by name |
| `listTools(serverId)` | List tools for a server |
| `callTool(serverId, tool, args)` | Call a tool (auto-signs x402) |
| `startServer(serverId)` / `stopServer(serverId)` | Start/stop on-demand |
| `storeSecrets(serverId, secrets)` | Store API keys |
| `authenticateAuto(options)` | Production-safe auth |

### SpendingWallet

| Method | Description |
|--------|-------------|
| `fromPrivateKey(key, policy?)` | Create from hex private key |
| `fromSeedPhrase(seed, index?, policy?)` | Derive from BIP-39 mnemonic |
| `getBalance(rpcUrl?)` | Check USDC and ETH balances |
| `getSpending()` | Current spending summary |
| `destroy()` | Clear private key from memory |

**Spending Policy (8-layer defense):** Per-call ($0.01), session ($1), daily ($5), weekly ($20) limits, endpoint allowlist, circuit breaker (5 failures), deduplication (30s), optional approval callback.

### A2AClient

| Method | Description |
|--------|-------------|
| `sendMessage(request)` | Non-streaming message |
| `sendStreamingMessage(request)` | SSE streaming |
| `storeApiKey(apiKey)` | Store Anthropic key in vault |
| `listTasks(options?)` | List tasks |

### AgentMCPClient

| Method | Description |
|--------|-------------|
| `connect(agentId)` | MCP initialize handshake |
| `listTools(agentId)` | List agent's MCP tools |
| `callTool(agentId, name, args?)` | Call a tool |

### CanvasClient

| Method | Description |
|--------|-------------|
| `executeWorkflow(request, signal?)` | SSE streaming execution (async generator) |
| `executeWorkflowSync(request, options?)` | Wait for complete result |
| `listWorkflows()` | List saved workflows from Geo |
| `saveWorkflow(workflow)` | Save a new workflow |
| `listRuns()` | List execution runs |
| `getRun(runId)` | Get run details |
| `approveGate(runId, approvalId, decision)` | Approve/reject an approval gate |

### Error Handling

All errors extend `MCPGatewayError`. Key subtypes: `SpendingLimitExceededError`, `CircuitBreakerTrippedError`, `EndpointNotAllowedError`, `DuplicatePaymentError`, `PaymentSigningError`.

</details>

## Architecture

| Service | URL | Purpose |
|---------|-----|---------|
| MCP Gateway | https://mcp.rickydata.org | MCP server hosting + tool proxy |
| Agent Gateway | https://agents.rickydata.org | BYOK Claude agents + canvas runtime |
| Marketplace | https://marketplace.rickydata.org | Browse + manage servers |

Source: [`rickydata_SDK`](https://github.com/rickycambrian/rickydata_SDK) (this repo) / [`mcp_deployments_registry`](https://github.com/rickycambrian/mcp_deployments_registry) (platform)

## Configuration

Config: `~/.rickydata/config.json` | Credentials: `~/.rickydata/credentials.json` (mode 0600)

Profiles allow multiple gateway configurations. `mcpg` is available as a compatibility alias.

## Testing

```bash
npm test        # Run all tests
npm run build   # Build TypeScript
```

## License

MIT
