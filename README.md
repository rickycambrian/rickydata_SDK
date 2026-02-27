# rickydata

TypeScript SDK and CLI for the MCP Gateway — auth, agents, tool calling, and x402 payments on Base mainnet.

> Extracted from the [mcp_deployments_registry](https://github.com/rickycambrian/mcp_deployments_registry) monorepo into a standalone repo for independent versioning. The monorepo retains a read-only copy at `mcp-gateway-sdk/`.

## Install

```bash
npm install -g rickydata
```

## Architecture

This SDK connects to the MCP Gateway ecosystem:
- **MCP Gateway**: https://mcp.rickydata.org — MCP server hosting + tool proxy
- **Agent Gateway**: https://agents.rickydata.org — BYOK Claude agents
- **Marketplace**: https://mcpmarketplace.rickydata.org — Browse + manage servers
- **Source**: Extracted from [mcp_deployments_registry](https://github.com/rickycambrian/mcp_deployments_registry)

### Repo Relationship

| Repo | Purpose |
|------|---------|
| [`rickydata_SDK`](https://github.com/rickycambrian/rickydata_SDK) | **This repo** — SDK library + CLI (`rickydata` on npm) |
| [`mcp_deployments_registry`](https://github.com/rickycambrian/mcp_deployments_registry) | Platform monorepo — gateway backends, marketplace, `.claude/` skills/agents |
| `mcp_deployments_registry/mcp-gateway-sdk/` | Read-only legacy reference copy (do not use) |

The SDK is published independently from the monorepo. Development happens here; deploy-time configuration (skills, agents, CI/CD) lives in `mcp_deployments_registry`.

## CLI Quick Start

```bash
# 1. Install
npm install -g rickydata

# 2. Log in (opens browser for sign-in via email, Google, GitHub, Discord, or wallet)
rickydata auth login

# 3. Search and enable MCP servers
rickydata mcp search "brave"
rickydata mcp enable brave-search-mcp-server   # requires auth

# 4. Connect the gateway to Claude Code (prints the claude mcp add command)
rickydata mcp connect

# 5. List your enabled tools
rickydata mcp tools

# 6. Call a tool directly with auto x402 payment
rickydata mcp call io-github-brave-brave-search-mcp-server__brave_web_search '{"query":"MCP protocol"}'

# 7. Check wallet balance and deposit address
rickydata wallet balance

# 8. Set your Anthropic API key for agent chat (BYOK — required)
rickydata apikey set

# 9. Chat with an agent
rickydata agents list
rickydata chat <agent-id>
```

`mcpg` is still available as a compatibility alias.

### Authentication Methods

| Method | Command | Best For |
|--------|---------|----------|
| Browser login | `rickydata auth login` | Quick start — sign in with email, Google, GitHub, Discord, or wallet |
| Private key | `rickydata auth login --private-key <key>` | Long-lived token (30 days), no browser needed |
| Direct token | `rickydata auth login --token mcpwt_...` | Pre-existing wallet tokens |

**Browser login flow** (recommended — no private key required):
1. Run `rickydata auth login`
2. Browser opens to `https://mcpmarketplace.rickydata.org/#/auth/cli`
3. Sign in with email, Google, GitHub, Discord, or any Web3 wallet
4. Copy the generated token from the page
5. Paste into the CLI prompt and press Enter
6. Token is stored in `~/.rickydata/credentials.json`

## CLI Command Reference

```
rickydata
├── auth
│   ├── login          Log in via browser, Privy, or wallet private key
│   ├── status         Show current auth status and wallet balance
│   ├── logout         Clear stored credentials
│   └── token
│       └── create     Generate a wallet token (long-lived)
├── agents
│   ├── list           List available agents
│   └── describe <id>  Show agent details and capabilities
├── chat <agent-id>    Interactive chat with an agent (requires BYOK)
├── sessions
│   ├── list           List chat sessions
│   ├── get            View session messages
│   ├── resume         Continue a previous session
│   └── delete         Delete a session
├── wallet
│   ├── balance        Show USDC balance and deposit address
│   ├── transactions   List recent transactions
│   └── settings
│       ├── show       Display wallet settings
│       └── set        Update a setting
├── apikey
│   ├── set            Store your Anthropic API key (required for agents)
│   ├── status         Check if BYOK is configured
│   └── delete         Remove stored API key
├── mcp
│   ├── search <query> Search marketplace servers by name/category
│   ├── enable <name>  Enable a server by name or ID (requires auth)
│   ├── disable <name> Disable a server (requires auth)
│   ├── tools          List tools from enabled servers (requires auth)
│   ├── call <tool>    Call a tool directly (auto-pays x402 if needed)
│   ├── info <name>    Get detailed server information
│   ├── connect        Print the claude mcp add command for connecting
│   └── agent
│       ├── tools <id> List an agent's MCP tools
│       └── call <id>  Call an MCP tool on an agent
└── config
    ├── set            Set a config value
    ├── get            Get a config value
    ├── list           Show all config
    ├── activate       Switch active profile
    └── profiles       List profiles
```

### Chat REPL Slash Commands

Inside `rickydata chat`, type:
- `/session` — show current session ID
- `/model <name>` — switch model (`haiku`, `sonnet`, `opus`)
- `/cost` — show accumulated session cost in USDC
- `/exit` — exit chat

## Connecting MCP Servers to Claude Code

The easiest way — after logging in, just run:

```bash
rickydata mcp connect
# Prints the exact claude mcp add command with your token pre-filled
```

Or manually:

```bash
# No auth (all tools, no wallet scoping)
claude mcp add --transport http mcp-gateway https://mcp.rickydata.org/mcp

# With auth (wallet-scoped, only tools from servers you've enabled)
claude mcp add --transport http \
  --header "Authorization:Bearer YOUR_TOKEN" \
  mcp-gateway https://mcp.rickydata.org/mcp
```

### Listing Gateway Tools

```bash
# Search for servers
rickydata mcp search "filesystem"

# Enable a server (wallet-scoped)
rickydata mcp enable filesystem-mcp-server

# List your enabled tools
rickydata mcp tools

# Call a tool (auto-pays $0.0005 USDC if needed)
rickydata mcp call <tool-slug-name> '{"arg": "value"}'
```

### Using an Agent as MCP Server

```bash
# List an agent's tools
rickydata mcp agent tools <agent-id>

# Call an agent's MCP tool
rickydata mcp agent call <agent-id> <tool-name> '{"arg": "value"}'
```

## Wallet & Funding

All payments use **USDC on Base mainnet** (Chain 8453). No other network is accepted.

```bash
# Check balance and get deposit address
rickydata wallet balance

# View recent transactions
rickydata wallet transactions
```

### Cost Breakdown

| Action | Cost |
|--------|------|
| MCP tool call | $0.0005 USDC |
| Agent chat | 10% platform markup on Anthropic LLM cost |
| Browsing servers/agents | Free |
| tools/list | Free |

### Funding Your Wallet

1. Run `rickydata wallet balance` to see your deposit address
2. Send **USDC on Base mainnet** to that address
3. Or use the web interface: https://mcpmarketplace.rickydata.org/#/wallet

> **Important**: Send ONLY USDC on Base mainnet (Chain 8453). Other networks are NOT auto-credited.

---

## SDK Usage (TypeScript)

For programmatic integration in your own applications.

### Browse Servers (No Auth Required)

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

Tool calls cost **$0.0005 USDC** each (500 base units, USDC has 6 decimals) on **Base mainnet** (chain 8453). The SDK handles payment automatically:

1. You call `gw.callTool(serverId, toolName, args)`
2. The gateway responds with HTTP 402 and payment requirements
3. The SDK signs an EIP-3009 `TransferWithAuthorization` (gasless, no on-chain tx from your side)
4. The SDK retries the request with a `PAYMENT-SIGNATURE` header
5. The gateway verifies the signature, executes the tool, then settles on-chain only on success

Create a `SpendingWallet` with safety limits, then pass it to the gateway:

```typescript
import { MCPGateway, SpendingWallet } from 'rickydata';
import { privateKeyToAccount } from 'viem/accounts';

const wallet = await SpendingWallet.fromPrivateKey(process.env.PRIVATE_KEY!, {
  maxPerCall: 0.01,        // Max $0.01 per tool call
  maxPerSession: 1.0,      // Max $1.00 this session
  maxPerDay: 5.0,          // Max $5.00 rolling 24h
  maxPerWeek: 20.0,        // Max $20.00 rolling 7d
  allowedEndpoints: ['mcp.rickydata.org'],
});

const gw = new MCPGateway({
  url: 'https://mcp.rickydata.org',
  spendingWallet: wallet,
});

// Authenticate (required for secrets + wallet-scoped tools)
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
await gw.authenticateAuto({
  signFn: (message) => account.signMessage({ message }),
  walletAddress: account.address,
});

// Call a tool -- payment is signed automatically
const result = await gw.callTool(
  '00a36b1c-a28a-439e-940b-165bb8ef1d12',
  'brave_web_search',
  { query: 'MCP model context protocol' },
);

console.log(result.content);

// Check spending
const spending = gw.getSpending();
console.log(`${spending.callCount} calls, $${spending.sessionSpent.toFixed(4)} spent`);

wallet.destroy(); // Clear private key from memory
```

### Agent Chat (Requires BYOK)

Agents require your own Anthropic API key. The gateway charges a 10% platform markup on LLM cost + $0.0005 per MCP tool call.

```typescript
import { A2AClient } from 'rickydata/a2a';

const client = new A2AClient({
  baseUrl: 'https://agents.rickydata.org',
  token: walletToken, // preferred: long-lived wallet token (mcpwt_...)
});

// Store your Anthropic key in the gateway's encrypted vault
await client.storeApiKey('sk-ant-...');

// Chat — gateway uses YOUR key, charges only 10% markup
const task = await client.sendMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Research MCP protocol' }] },
  metadata: { agentId: 'research-agent', contextId: 'my-session' },
});
console.log(task.metadata?.cost); // { total: "120", llm: "120", tools: "0", byok: true, model: "..." }

// Stream a response
for await (const event of client.sendStreamingMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Explain x402' }] },
  metadata: { agentId: 'research-agent' },
})) {
  if ('artifact' in event) {
    for (const part of event.artifact.parts) {
      if (part.type === 'text') process.stdout.write(part.text);
    }
  }
}
```

### Agent as MCP Server

Use any agent as a standard MCP server. Each agent exposes its skills as MCP tools via `POST /agents/:id/mcp`.

```typescript
import { AgentMCPClient } from 'rickydata';

const client = new AgentMCPClient({
  privateKey: process.env.PRIVATE_KEY!, // or: token: 'mcpwt_...'
});

// Connect (MCP initialize handshake)
const info = await client.connect('research-agent');
console.log(`${info.serverInfo.name} v${info.serverInfo.version}`);

// List available tools (agent skills with tool metadata)
const tools = await client.listTools('research-agent');
for (const tool of tools) {
  console.log(`  ${tool.name}: ${tool.description}`);
}

// Call a tool
const result = await client.callTool('research-agent', 'web_research', {
  topic: 'MCP protocol',
});
console.log(result.content[0].text);
```

### HD Wallet (Production Agents)

Derive isolated spending wallets from a BIP-39 seed phrase using path `m/44'/60'/8453'/0/{index}`:

```typescript
import { SpendingWallet } from 'rickydata';

const wallet = await SpendingWallet.fromSeedPhrase(
  process.env.SEED_PHRASE!,
  0, // index
  { maxPerDay: 10.0, circuitBreakerThreshold: 5 },
);

console.log(wallet.address);    // Deterministic -- same seed+index = same address
console.log(wallet.isHD);       // true
```

## BYOK — Bring Your Own Key (Required for Agents)

Agent chat **requires** your own Anthropic API key. The gateway charges a **10% platform markup** on LLM cost + $0.0005 per MCP tool call.

```bash
# CLI
rickydata apikey set
# Prompts for your sk-ant-... key

# Check status
rickydata apikey status
```

```typescript
// SDK
const client = new A2AClient({
  baseUrl: 'https://agents.rickydata.org',
  token: 'your-token',
});

await client.storeApiKey('sk-ant-...');
const task = await client.sendMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
  metadata: { agentId: 'research-agent' },
});
// task.metadata.cost.byok === true
```

## Configuration

Config: `~/.rickydata/config.json`
Credentials: `~/.rickydata/credentials.json` (mode 0600)

Default gateways:
- Agent: `https://agents.rickydata.org`
- MCP: `https://mcp.rickydata.org`

Profiles allow multiple gateway configurations. Compatibility migration from `~/.mcpg/*` runs automatically on first launch.

---

## SDK API Reference

### MCPGateway

| Method | Returns | Description |
|--------|---------|-------------|
| `listServers(opts?)` | `Promise<Server[]>` | List servers. Filter by `registry`, `deploymentType`, `gatewayCompatible`. |
| `getServer(id)` | `Promise<ServerDetail>` | Get server details including tools |
| `searchServers(query)` | `Promise<Server[]>` | Search servers by name |
| `listTools(serverId)` | `Promise<Tool[]>` | List tools for a server |
| `callTool(serverId, tool, args)` | `Promise<ToolResult>` | Call a tool (auto-signs x402) |
| `startServer(serverId)` | `Promise<void>` | Start a server on-demand |
| `stopServer(serverId)` | `Promise<void>` | Stop a running server |
| `storeSecrets(serverId, secrets)` | `Promise<void>` | Store API keys for a server |
| `getSecrets(serverId)` | `Promise<string[]>` | List stored secret names |
| `deleteSecrets(serverId)` | `Promise<void>` | Delete stored secrets |
| `authenticateAuto(options)` | `Promise<AuthSession \| null>` | Production-safe auth strategy (operator ERC-8128, user wallet-token first, JWT fallback) |
| `authenticate(signFn?, address?)` | `Promise<AuthSession>` | Compatibility auth API |
| `getPaymentConfig()` | `Promise<PaymentConfig>` | Get x402 payment configuration |
| `getSpending()` | `SpendingSummary` | Current spending summary |
| `wallet` | `SpendingWallet \| null` | Access the underlying wallet |

### SpendingWallet

#### Factory Methods

| Method | Description |
|--------|-------------|
| `SpendingWallet.fromPrivateKey(key, policy?)` | Create from a hex private key |
| `SpendingWallet.fromSeedPhrase(seed, index?, policy?)` | Derive from BIP-39 mnemonic |
| `SpendingWallet.generate(policy?)` | Random wallet (dev/testing only) |

#### Instance Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getBalance(rpcUrl?)` | `Promise<{ usdc, eth }>` | Check USDC and ETH balances on Base |
| `getSpending()` | `SpendingSummary` | Total, session, day, week spend + call count |
| `getRemainingBudget(period)` | `number` | Remaining USD for `'day'`, `'week'`, or `'session'` |
| `getHistory({ limit? })` | `PaymentReceipt[]` | Payment history |
| `getPolicyStats()` | `object` | Full policy and circuit breaker state |
| `resetCircuitBreaker()` | `void` | Manually reset the circuit breaker |
| `exportHistory()` | `object` | Serialize history for persistence |
| `importHistory(data)` | `void` | Restore previously exported history |
| `destroy()` | `void` | Clear private key from memory |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | Wallet address (safe to log) |
| `isHD` | `boolean` | Whether derived from a seed phrase |

#### Spending Policy (8-layer defense)

| Layer | Default | Description |
|-------|---------|-------------|
| Per-call limit | $0.01 | Max USD per individual tool call |
| Session limit | $1.00 | Max USD for the SDK instance lifetime |
| Daily limit | $5.00 | Rolling 24-hour window |
| Weekly limit | $20.00 | Rolling 7-day window |
| Endpoint allowlist | allow all | Restrict to specific gateway hostnames |
| Circuit breaker | 5 failures | Halt payments after N consecutive failures (300s cooldown) |
| Deduplication | 30s window | Reject identical payments within the window |
| Approval callback | disabled | Human-in-the-loop for amounts above a threshold |

#### Events

```typescript
wallet.on('payment:signed', (receipt) => {
  console.log(`Paid $${receipt.amountUsd} for ${receipt.toolName}`);
});

wallet.on('spending:warning', ({ period, percentUsed }) => {
  console.log(`${percentUsed.toFixed(0)}% of ${period} budget used`);
});

wallet.on('payment:rejected', ({ reason, message }) => {
  console.error(`Rejected: ${reason} -- ${message}`);
});

wallet.on('circuit-breaker:tripped', ({ failureCount }) => {
  console.error(`Circuit breaker after ${failureCount} failures`);
});

wallet.on('balance:low', ({ balance, threshold }) => {
  console.warn(`Low balance: ${balance} USDC (threshold: ${threshold})`);
});
```

### A2AClient

| Method | Returns | Description |
|--------|---------|-------------|
| `getAgentCard()` | `Promise<AgentCard>` | Public agent card (no auth) |
| `getExtendedAgentCard()` | `Promise<ExtendedAgentCard>` | Card with user balance (auth) |
| `sendMessage(request)` | `Promise<Task>` | Non-streaming message, returns Task with cost |
| `sendStreamingMessage(request)` | `AsyncGenerator<StreamEvent>` | SSE streaming message |
| `getTask(taskId)` | `Promise<Task>` | Get task state |
| `listTasks(options?)` | `Promise<TaskListResponse>` | List tasks (`limit`, `cursor`, `contextId`) |
| `subscribeToTask(taskId)` | `AsyncGenerator<StreamEvent>` | SSE subscription to task updates |
| `cancelTask(taskId)` | `Promise<Task>` | Cancel a task |
| `setToken(token)` | `void` | Update auth token |
| `setAnthropicApiKey(key)` | `void` | Set API key for BYOK mode (sent as header) |
| `storeApiKey(apiKey)` | `Promise<{success, configured}>` | Store Anthropic key in gateway vault |
| `getApiKeyStatus()` | `Promise<{configured}>` | Check if API key is configured |
| `deleteApiKey()` | `Promise<{success, configured}>` | Remove stored API key |

### AgentMCPClient

| Method | Returns | Description |
|--------|---------|-------------|
| `connect(agentId)` | `Promise<MCPServerInfo>` | MCP initialize handshake |
| `listTools(agentId)` | `Promise<MCPTool[]>` | List agent's MCP tools |
| `callTool(agentId, name, args?)` | `Promise<MCPToolResult>` | Call a tool (requires USDC balance) |

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `https://agents.rickydata.org` | Agent Gateway URL |
| `privateKey` | `string` | -- | Wallet private key (auto-authenticates) |
| `token` | `string` | -- | Pre-existing wallet-auth token (`mcpwt_...`; compatibility JWT accepted) |

Either `privateKey` or `token` is required.

---

## Error Handling

All errors extend `MCPGatewayError`:

```typescript
import {
  MCPGatewayError,
  SpendingPolicyError,
  SpendingLimitExceededError,
  EndpointNotAllowedError,
  DuplicatePaymentError,
  CircuitBreakerTrippedError,
  PaymentSigningError,
} from 'rickydata';

try {
  await gw.callTool(serverId, 'tool_name', { arg: 'value' });
} catch (err) {
  if (err instanceof SpendingLimitExceededError) {
    // err.violation: 'CALL_LIMIT' | 'SESSION_LIMIT' | 'DAILY_LIMIT' | 'WEEKLY_LIMIT'
    console.error(`Limit exceeded: ${err.violation}`);
  } else if (err instanceof CircuitBreakerTrippedError) {
    wallet.resetCircuitBreaker();
  } else if (err instanceof EndpointNotAllowedError) {
    console.error('Endpoint not in allowlist');
  } else if (err instanceof DuplicatePaymentError) {
    console.error('Duplicate payment detected');
  } else if (err instanceof PaymentSigningError) {
    console.error('EIP-3009 signing failed');
  }
}
```

### Error Hierarchy

```
MCPGatewayError
  SpendingPolicyError (has .violation: PolicyViolationType)
    SpendingLimitExceededError
    EndpointNotAllowedError
    DuplicatePaymentError
    CircuitBreakerTrippedError
  PaymentSigningError
```

## Examples

| File | Description |
|------|-------------|
| [`examples/quick-start.ts`](./examples/quick-start.ts) | Browse servers without a wallet |
| [`examples/spending-wallet.ts`](./examples/spending-wallet.ts) | Call a tool with x402 payment and safety limits |
| [`examples/hd-wallet.ts`](./examples/hd-wallet.ts) | Derive multiple wallets from a seed phrase |
| [`examples/byok-chat.ts`](./examples/byok-chat.ts) | Chat with your own Anthropic API key (required) |
| [`examples/agent-mcp.ts`](./examples/agent-mcp.ts) | Connect to an agent as an MCP server |

Run any example:

```bash
npx tsx examples/quick-start.ts
PRIVATE_KEY=0x... npx tsx examples/spending-wallet.ts
SEED_PHRASE="word1 word2 ..." npx tsx examples/hd-wallet.ts
AUTH_TOKEN=... ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/byok-chat.ts
```

## Testing

```bash
npm test        # Run all tests
npm run build   # Build TypeScript

# Live integration tests (makes real $0.0005 USDC payments on Base mainnet)
LIVE_TEST=1 npx vitest run tests/live.test.ts
```

## License

MIT
