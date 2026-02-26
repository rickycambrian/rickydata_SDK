# rickydata

TypeScript SDK and CLI for the MCP Gateway — auth, agents, tool calling, and x402 payments on Base mainnet.

> Migrated from `@mcp-gateway/sdk` in the mcp_deployments_registry monorepo.

```bash
npm install rickydata
```

Peer dependency: `viem ^2.0.0`

## Architecture

This SDK connects to the MCP Gateway ecosystem:
- **MCP Gateway**: https://mcp.rickydata.org — MCP server hosting + tool proxy
- **Agent Gateway**: https://agents.rickydata.org — BYOK Claude agents
- **Marketplace**: https://mcpmarketplace.rickydata.org — Browse + manage servers
- **Source**: Extracted from [mcp_deployments_registry](https://github.com/rickycambrian/mcp_deployments_registry)

## Quick Start (No Wallet)

Browse servers and tools without any wallet or authentication:

```ts
import { MCPGateway } from 'rickydata';

const gw = new MCPGateway({ url: 'https://mcp.rickydata.org' });

const servers = await gw.listServers();
console.log(`${servers.length} servers available`);

for (const s of servers.slice(0, 5)) {
  console.log(`  ${s.name} -- ${s.toolsCount} tools`);
}
```

## Calling Tools with x402 Payments

Tool calls cost **$0.0005 USDC** each (500 base units, USDC has 6 decimals) on **Base mainnet** (chain 8453). The SDK handles payment automatically:

1. You call `gw.callTool(serverId, toolName, args)`
2. The gateway responds with HTTP 402 and payment requirements
3. The SDK signs an EIP-3009 `TransferWithAuthorization` (gasless, no on-chain tx from your side)
4. The SDK retries the request with a `PAYMENT-SIGNATURE` header
5. The gateway verifies the signature, executes the tool, then settles on-chain only on success

### SpendingWallet (Recommended)

Create a `SpendingWallet` with safety limits, then pass it to the gateway:

```ts
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

## ERC-8128 Auth Mode (Operator / Agent Integrations)

For programmatic agent/operator traffic you can skip bearer tokens entirely and sign each request with ERC-8128:

```ts
import { MCPGateway } from 'rickydata';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const gw = new MCPGateway({ url: 'https://mcp.rickydata.org' });

await gw.authenticateWithErc8128({
  chainId: 8453,
  address: account.address,
  signMessage: async (message) => {
    const raw = `0x${Buffer.from(message).toString('hex')}` as `0x${string}`;
    return account.signMessage({ message: { raw } }) as Promise<`0x${string}`>;
  },
});

const servers = await gw.listServers();
console.log(servers.length);
```

This mode is additive. `authenticateAuto(...)` chooses ERC-8128 for operator strict paths and wallet-token first for user paths.

### HD Wallet (Production Agents)

Derive isolated spending wallets from a BIP-39 seed phrase using path `m/44'/60'/8453'/0/{index}`:

```ts
import { SpendingWallet } from 'rickydata';

const wallet = await SpendingWallet.fromSeedPhrase(
  process.env.SEED_PHRASE!,
  0, // index
  { maxPerDay: 10.0, circuitBreakerThreshold: 5 },
);

console.log(wallet.address);    // Deterministic -- same seed+index = same address
console.log(wallet.isHD);       // true
```

### Private Key Config

You can also pass a private key directly in the config. The SDK creates a `SpendingWallet` internally:

```ts
const gw = new MCPGateway({
  url: 'https://mcp.rickydata.org',
  wallet: { privateKey: process.env.PRIVATE_KEY! },
  payment: { autoSign: true, maxPerCall: '0.01', maxDaily: '5.0' },
});
```

The `spendingWallet` option is preferred because it gives you direct access to events, balance checking, and budget monitoring.

## Monitoring Events

`SpendingWallet` emits typed events:

```ts
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

## SpendingWallet API

### Factory Methods

| Method | Description |
|--------|-------------|
| `SpendingWallet.fromPrivateKey(key, policy?)` | Create from a hex private key |
| `SpendingWallet.fromSeedPhrase(seed, index?, policy?)` | Derive from BIP-39 mnemonic |
| `SpendingWallet.generate(policy?)` | Random wallet (dev/testing only) |

### Instance Methods

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

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | Wallet address (safe to log) |
| `isHD` | `boolean` | Whether derived from a seed phrase |

## MCPGateway API

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
| `authenticate(signFn?, address?)` | `Promise<AuthSession>` | Compatibility auth API (kept for backward compatibility) |
| `getPaymentConfig()` | `Promise<PaymentConfig>` | Get x402 payment configuration |
| `getSpending()` | `SpendingSummary` | Current spending summary |
| `wallet` | `SpendingWallet \| null` | Access the underlying wallet |

## Spending Policy

The `SpendingWallet` enforces an 8-layer defense before signing any payment:

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

```ts
const wallet = await SpendingWallet.fromPrivateKey(key, {
  maxPerCall: 0.005,
  maxPerDay: 2.0,
  allowedEndpoints: ['mcp.rickydata.org'],
  circuitBreakerThreshold: 3,
  requireApprovalAbove: 0.005,
  approvalCallback: async (details) => {
    console.log(`Approve $${details.amountUsd} for ${details.toolName}?`);
    return true; // or prompt the user
  },
  dryRun: false, // Set true to validate without signing
});
```

## A2A Client

The SDK includes an A2A protocol client for communicating with the Agent Gateway programmatically.

```ts
import { A2AClient } from 'rickydata/a2a';

const client = new A2AClient({
  baseUrl: 'https://agents.rickydata.org',
  token: walletToken, // preferred: long-lived wallet token (mcpwt_...)
});

// Discover available agents
const card = await client.getAgentCard();
console.log(`${card.skills.length} agents available`);

// Send a message (non-streaming, returns completed Task with cost)
const task = await client.sendMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Research MCP protocol' }] },
  metadata: { agentId: 'research-agent', contextId: 'my-session' },
});
console.log(task.metadata?.cost); // { total: "120", llm: "120", tools: "0", model: "claude-haiku-4-5-20251001" }

// Stream a response
for await (const event of client.sendStreamingMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Explain x402' }] },
  metadata: { agentId: 'research-agent' },
})) {
  if ('artifact' in event) {
    // TaskArtifactUpdateEvent — text chunk
    for (const part of event.artifact.parts) {
      if (part.type === 'text') process.stdout.write(part.text);
    }
  }
}

// List tasks filtered by contextId
const { tasks } = await client.listTasks({ contextId: 'my-session', limit: 10 });

// Subscribe to task updates (SSE)
for await (const event of client.subscribeToTask(task.id)) {
  console.log('Task update:', event);
}
```

### A2AClient API

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

### BYOK (Bring Your Own Key)

Supply your own Anthropic API key to reduce costs. The gateway charges only a **10% markup** on LLM cost + $0.0005/MCP tool call (instead of the full LLM cost + 15% TEE overhead).

```ts
const client = new A2AClient({
  baseUrl: 'https://agents.rickydata.org',
  token: walletToken,
  anthropicApiKey: 'sk-ant-...', // sent as X-Anthropic-Api-Key header
});

// Store key in gateway's encrypted in-memory vault
await client.storeApiKey('sk-ant-...');

// Chat — gateway uses YOUR key, charges only 10% markup
const task = await client.sendMessage({
  message: { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
  metadata: { agentId: 'research-agent' },
});
// task.metadata.cost.byok === true

// Check status / remove key
const { configured } = await client.getApiKeyStatus();
await client.deleteApiKey();
```

## Agent MCP Client

Use any agent as a standard MCP server. Each agent exposes its skills as MCP tools via `POST /agents/:id/mcp`.

```ts
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

### AgentMCPClient API

| Method | Returns | Description |
|--------|---------|-------------|
| `connect(agentId)` | `Promise<MCPServerInfo>` | MCP initialize handshake |
| `listTools(agentId)` | `Promise<MCPTool[]>` | List agent's MCP tools |
| `callTool(agentId, name, args?)` | `Promise<MCPToolResult>` | Call a tool (requires USDC balance) |

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baseUrl` | `string` | `https://agents.rickydata.org` | Agent Gateway URL |
| `privateKey` | `string` | -- | Wallet private key (auto-authenticates) |
| `token` | `string` | -- | Pre-existing wallet-auth token (`mcpwt_...`; compatibility JWT accepted) |

Either `privateKey` or `token` is required.

## Error Handling

All errors extend `MCPGatewayError`:

```ts
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
| [`examples/byok-chat.ts`](./examples/byok-chat.ts) | Chat with your own Anthropic API key (10% markup) |
| [`examples/agent-mcp.ts`](./examples/agent-mcp.ts) | Connect to an agent as an MCP server |

Run any example:

```bash
npx tsx examples/quick-start.ts
PRIVATE_KEY=0x... npx tsx examples/spending-wallet.ts
SEED_PHRASE="word1 word2 ..." npx tsx examples/hd-wallet.ts
AUTH_TOKEN=... ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/byok-chat.ts
```

## CLI (`rickydata`)

The package ships a command-line tool for interacting with the Agent and MCP Gateways directly from your terminal.

### Installation

```bash
npm install -g rickydata
```

### Quick Start

```bash
# 1. Sign in (browser — no private key required)
rickydata auth login
# Opens browser → sign in with email/social/wallet → copy token → paste

# 2. List available agents
rickydata agents list

# 3. Start an interactive chat session
rickydata chat <agent-id>

# 4. (Optional) Enable BYOK pricing (10% markup only)
rickydata apikey set
```

`mcpg` is still available as a compatibility alias.

### Auth Methods

The CLI supports multiple authentication methods:

```bash
# Browser (default — no flags needed)
# Opens https://mcpmarketplace.rickydata.org/#/auth/cli
# Sign in with email, Google, GitHub, Discord, or any Web3 wallet
# Copy the token shown and paste it into the terminal
rickydata auth login

# Wallet private key (creates a long-lived mcpwt_ token)
rickydata auth login --private-key 0xYOUR_KEY

# Direct token (if you already have one from the marketplace UI)
rickydata auth login --token mcpwt_...

# Privy access token exchange (programmatic — exchanges a Privy access token for a gateway JWT)
rickydata auth login --privy <privy-access-token>

# Check auth status
rickydata auth status
```

**Browser login flow** (recommended — no private key required):
1. Run `rickydata auth login`
2. Browser opens to `https://mcpmarketplace.rickydata.org/#/auth/cli`
3. Sign in with email, Google, GitHub, Discord, or any Web3 wallet
4. Copy the generated token from the page
5. Paste into the CLI prompt and press Enter
6. Token is stored in `~/.rickydata/credentials.json`

### Command Reference

| Command | Description |
|---------|-------------|
| `rickydata auth login` | Browser login (default, no flags) — opens marketplace CLI auth page; or pass `--private-key`, `--token`, `--privy` |
| `rickydata auth status` | Show current auth status |
| `rickydata auth logout` | Clear stored credentials |
| `rickydata auth token create` | Create a long-lived wallet token (`mcpwt_`) |
| `rickydata config set <key> <value>` | Set a config value |
| `rickydata config get <key>` | Get a config value |
| `rickydata config list` | List all config values in active profile |
| `rickydata config activate <profile>` | Switch active profile |
| `rickydata config profiles` | List profiles |
| `rickydata agents list` | List available agents |
| `rickydata agents describe <id>` | Show full agent details |
| `rickydata chat <agent-id>` | Start interactive chat REPL |
| `rickydata sessions list [agent-id]` | List sessions |
| `rickydata sessions get <agent-id> <session-id>` | Show session details |
| `rickydata sessions resume <session-id> <agent-id>` | Resume a session |
| `rickydata sessions delete <agent-id> <session-id>` | Delete a session |
| `rickydata wallet balance` | Show USDC balance |
| `rickydata wallet transactions` | List recent transactions |
| `rickydata wallet settings show` | Show wallet settings |
| `rickydata wallet settings set <key> <val>` | Update a wallet setting |
| `rickydata apikey set` | Store Anthropic API key for BYOK |
| `rickydata apikey status` | Check if API key is configured |
| `rickydata apikey delete` | Remove stored API key |
| `rickydata mcp tools <agent-id>` | List an agent's MCP tools |
| `rickydata mcp call <agent-id> <tool> [args]` | Call an MCP tool |

### Configuration Files

| File | Description |
|------|-------------|
| `~/.rickydata/config.json` | Profiles and gateway URLs |
| `~/.rickydata/credentials.json` | Tokens (mode 0600) |

Compatibility migration from `~/.mcpg/*` runs automatically on first launch.

Default gateway URLs:
- Agent Gateway: `https://agents.rickydata.org`
- MCP Gateway: `https://mcp.rickydata.org`

### Chat REPL Slash Commands

Inside `rickydata chat`, type:
- `/session` — show current session ID
- `/model <name>` — switch model (`haiku`, `sonnet`, `opus`)
- `/cost` — show accumulated session cost in USDC
- `/exit` — exit chat

## Testing

```bash
# Unit tests
npm test

# Live integration tests (makes real $0.0005 USDC payments on Base mainnet)
LIVE_TEST=1 npx vitest run tests/live.test.ts
```

## License

MIT
