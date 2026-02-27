# rickydata

TypeScript SDK and CLI for the [MCP Gateway](https://mcp.rickydata.org) — search 5,000+ MCP servers, enable tools, and use them in Claude Code or any MCP client.

## Install

```bash
npm install -g rickydata
```

## Get Started in 3 Steps

```bash
# 1. Log in (opens browser — sign in with email, Google, GitHub, Discord, or wallet)
rickydata auth login

# 2. Connect the MCP Gateway to Claude Code (auto-configures with your token)
rickydata mcp connect

# 3. Restart Claude Code — you now have access to 5,000+ MCP tools
```

That's it. Inside Claude Code you can now ask it to search for servers, enable them, and call tools directly.

### What You Can Do in Claude Code

Once connected, Claude Code has these meta-tools available:

- **`gateway__search_servers`** — search the marketplace by name or category
- **`gateway__server_info`** — get details about a specific server
- **`gateway__enable_server`** — enable a server to use its tools
- **`gateway__disable_server`** — disable a server
- **`gateway__list_enabled`** — see your currently enabled servers

Just ask Claude things like:
- "Search for a Brave search MCP server and enable it"
- "Find an arXiv paper search tool"
- "What servers do I have enabled?"
- "Disable the geo server"

Once a server is enabled, its tools appear and Claude can call them directly.

## CLI Quick Reference

Beyond the 3-step setup above, the CLI has additional commands:

```bash
# Search the marketplace (no auth needed)
rickydata mcp search "brave"
rickydata mcp search "database"

# Enable/disable servers
rickydata mcp enable brave-search-mcp-server
rickydata mcp disable brave-search-mcp-server

# List your enabled tools
rickydata mcp tools

# Call a tool directly from the CLI
rickydata mcp call blazickjp-arxiv-mcp-server__search_papers '{"query":"transformers","max_results":3}'

# Get server details
rickydata mcp info brave-search-mcp-server

# Check auth status
rickydata auth status

# Check wallet balance
rickydata wallet balance
```

## Agent Chat (BYOK)

Chat with AI agents that have access to MCP tools. Requires your own Anthropic API key (BYOK = Bring Your Own Key).

```bash
# Store your Anthropic API key
rickydata apikey set

# List available agents
rickydata agents list

# Start chatting
rickydata chat <agent-id>
```

Cost: 10% platform markup on Anthropic LLM cost + $0.0005 per MCP tool call the agent makes.

## Authentication

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
| Private key | `rickydata auth login --private-key 0x...` | Automated scripts, enables x402 signing |

### Auth Status

```bash
rickydata auth status
```

Shows your wallet address, token type, expiry, and USDC balance.

## Connecting to Claude Code

### Automatic (Recommended)

```bash
rickydata mcp connect
```

This runs `claude mcp add` for you with the correct URL and your auth token. Restart Claude Code afterward to pick up the new tools.

Use `--dry-run` to see the command without executing it:

```bash
rickydata mcp connect --dry-run
```

### Manual

```bash
# With auth (wallet-scoped tools)
claude mcp add --transport http mcp-gateway https://mcp.rickydata.org/mcp \
  --header "Authorization:Bearer YOUR_TOKEN"

# No auth (all tools, anonymous)
claude mcp add --transport http mcp-gateway https://mcp.rickydata.org/mcp
```

## Full CLI Command Tree

```
rickydata
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
├── chat <agent-id>    Interactive agent chat (requires BYOK)
├── sessions
│   ├── list           List chat sessions
│   ├── get            View session messages
│   ├── resume         Continue a session
│   └── delete         Delete a session
├── wallet
│   ├── balance        Show USDC balance and deposit address
│   ├── transactions   List recent transactions
│   └── settings
│       ├── show       Display wallet settings
│       └── set        Update a setting
├── apikey
│   ├── set            Store Anthropic API key (required for agents)
│   ├── status         Check BYOK status
│   └── delete         Remove stored API key
└── config
    ├── set            Set a config value
    ├── get            Get a config value
    ├── list           Show all config
    ├── activate       Switch active profile
    └── profiles       List profiles
```

### Chat REPL Slash Commands

Inside `rickydata chat`:
- `/session` — show current session ID
- `/model <name>` — switch model (`haiku`, `sonnet`, `opus`)
- `/cost` — show accumulated session cost
- `/exit` — exit chat

## Wallet & Payments

All payments use **USDC on Base mainnet** (Chain 8453).

| Action | Cost |
|--------|------|
| MCP tool call (via Claude Code) | Free (authenticated bypass) |
| MCP tool call (via CLI `mcp call`) | $0.0005 USDC (requires private key) |
| Agent chat | 10% markup on LLM cost |
| Browsing / searching / tools/list | Free |

### Funding Your Wallet

```bash
rickydata wallet balance   # Shows deposit address
```

Send USDC on Base mainnet to the address shown. Or use the web interface at https://mcpmarketplace.rickydata.org/#/wallet.

## Architecture

| Service | URL | Purpose |
|---------|-----|---------|
| MCP Gateway | https://mcp.rickydata.org | MCP server hosting + tool proxy |
| Agent Gateway | https://agents.rickydata.org | BYOK Claude agents |
| Marketplace | https://mcpmarketplace.rickydata.org | Browse + manage servers |
| npm | [`rickydata`](https://www.npmjs.com/package/rickydata) | This CLI + SDK |

### Repo Relationship

| Repo | Purpose |
|------|---------|
| [`rickydata_SDK`](https://github.com/rickycambrian/rickydata_SDK) | **This repo** — SDK + CLI |
| [`mcp_deployments_registry`](https://github.com/rickycambrian/mcp_deployments_registry) | Platform monorepo — gateway backends, marketplace |

---

## SDK Usage (TypeScript)

For programmatic integration in your own applications.

### Browse Servers (No Auth)

```typescript
import { MCPGateway } from 'rickydata';

const gw = new MCPGateway({ url: 'https://mcp.rickydata.org' });

const servers = await gw.listServers();
console.log(`${servers.length} servers available`);

for (const s of servers.slice(0, 5)) {
  console.log(`  ${s.name} -- ${s.toolsCount} tools`);
}
```

### Calling Tools with x402 Payments

Tool calls cost **$0.0005 USDC** each on **Base mainnet** (chain 8453). The SDK handles payment automatically:

1. You call `gw.callTool(serverId, toolName, args)`
2. The gateway responds with HTTP 402 and payment requirements
3. The SDK signs an EIP-3009 `TransferWithAuthorization` (gasless)
4. The SDK retries with a `PAYMENT-SIGNATURE` header
5. The gateway verifies, executes, and settles on success

```typescript
import { MCPGateway, SpendingWallet } from 'rickydata';
import { privateKeyToAccount } from 'viem/accounts';

const wallet = await SpendingWallet.fromPrivateKey(process.env.PRIVATE_KEY!, {
  maxPerCall: 0.01,
  maxPerSession: 1.0,
  maxPerDay: 5.0,
  maxPerWeek: 20.0,
  allowedEndpoints: ['mcp.rickydata.org'],
});

const gw = new MCPGateway({
  url: 'https://mcp.rickydata.org',
  spendingWallet: wallet,
});

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
await gw.authenticateAuto({
  signFn: (message) => account.signMessage({ message }),
  walletAddress: account.address,
});

const result = await gw.callTool(
  '00a36b1c-a28a-439e-940b-165bb8ef1d12',
  'brave_web_search',
  { query: 'MCP model context protocol' },
);
console.log(result.content);

wallet.destroy();
```

### Agent Chat (BYOK)

```typescript
import { A2AClient } from 'rickydata/a2a';

const client = new A2AClient({
  baseUrl: 'https://agents.rickydata.org',
  token: 'mcpwt_...',
});

await client.storeApiKey('sk-ant-...');

const task = await client.sendMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Research MCP protocol' }] },
  metadata: { agentId: 'research-agent', contextId: 'my-session' },
});
```

### Agent as MCP Server

```typescript
import { AgentMCPClient } from 'rickydata';

const client = new AgentMCPClient({ token: 'mcpwt_...' });

const info = await client.connect('research-agent');
const tools = await client.listTools('research-agent');
const result = await client.callTool('research-agent', 'web_research', {
  topic: 'MCP protocol',
});
```

### HD Wallet

Derive isolated spending wallets from a BIP-39 seed phrase:

```typescript
import { SpendingWallet } from 'rickydata';

const wallet = await SpendingWallet.fromSeedPhrase(
  process.env.SEED_PHRASE!,
  0,
  { maxPerDay: 10.0, circuitBreakerThreshold: 5 },
);
```

---

## SDK API Reference

### MCPGateway

| Method | Description |
|--------|-------------|
| `listServers(opts?)` | List servers (filter by registry, type, compatibility) |
| `getServer(id)` | Get server details |
| `searchServers(query)` | Search by name |
| `listTools(serverId)` | List tools for a server |
| `callTool(serverId, tool, args)` | Call a tool (auto-signs x402) |
| `startServer(serverId)` | Start on-demand |
| `stopServer(serverId)` | Stop a server |
| `storeSecrets(serverId, secrets)` | Store API keys |
| `authenticateAuto(options)` | Production-safe auth |

### SpendingWallet

| Method | Description |
|--------|-------------|
| `fromPrivateKey(key, policy?)` | Create from hex private key |
| `fromSeedPhrase(seed, index?, policy?)` | Derive from BIP-39 mnemonic |
| `generate(policy?)` | Random wallet (dev only) |
| `getBalance(rpcUrl?)` | Check USDC and ETH balances |
| `getSpending()` | Current spending summary |
| `destroy()` | Clear private key from memory |

#### Spending Policy (8-layer defense)

| Layer | Default | Description |
|-------|---------|-------------|
| Per-call limit | $0.01 | Max per tool call |
| Session limit | $1.00 | Max per SDK instance |
| Daily limit | $5.00 | Rolling 24h |
| Weekly limit | $20.00 | Rolling 7d |
| Endpoint allowlist | allow all | Restrict to specific hostnames |
| Circuit breaker | 5 failures | Halt after N consecutive failures |
| Deduplication | 30s window | Reject identical payments |
| Approval callback | disabled | Human-in-the-loop for large amounts |

### A2AClient

| Method | Description |
|--------|-------------|
| `sendMessage(request)` | Non-streaming message |
| `sendStreamingMessage(request)` | SSE streaming |
| `storeApiKey(apiKey)` | Store Anthropic key in vault |
| `getApiKeyStatus()` | Check BYOK status |
| `listTasks(options?)` | List tasks |

### AgentMCPClient

| Method | Description |
|--------|-------------|
| `connect(agentId)` | MCP initialize handshake |
| `listTools(agentId)` | List agent's MCP tools |
| `callTool(agentId, name, args?)` | Call a tool |

## Error Handling

```typescript
import {
  MCPGatewayError,
  SpendingLimitExceededError,
  CircuitBreakerTrippedError,
  EndpointNotAllowedError,
  DuplicatePaymentError,
  PaymentSigningError,
} from 'rickydata';

try {
  await gw.callTool(serverId, 'tool_name', { arg: 'value' });
} catch (err) {
  if (err instanceof SpendingLimitExceededError) {
    console.error(`Limit: ${err.violation}`);
  } else if (err instanceof CircuitBreakerTrippedError) {
    wallet.resetCircuitBreaker();
  }
}
```

## Testing

```bash
npm test        # Run all tests
npm run build   # Build TypeScript
```

## Configuration

Config: `~/.rickydata/config.json`
Credentials: `~/.rickydata/credentials.json` (mode 0600)

Profiles allow multiple gateway configurations. `mcpg` is available as a compatibility alias.

## License

MIT
