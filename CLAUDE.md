# CLAUDE.md

This is the rickydata SDK — a TypeScript SDK and CLI for the MCP Gateway, Agent Gateway, and Canvas Workflow runtime.

## Project structure

```
src/
  index.ts              # Public SDK exports
  client.ts             # MCPGateway class (MCP server discovery + tool calls)
  auth.ts               # AuthManager (wallet tokens, ERC-8128, challenge-response)
  constants.ts          # Chain IDs, USDC addresses, spending defaults
  canvas/
    types.ts            # Canvas workflow types (nodes, edges, SSE events, run state)
    canvas-client.ts    # CanvasClient (workflow execution with SSE streaming)
    index.ts            # Re-exports
  agent/
    agent-client.ts     # AgentClient (BYOK chat with SSE streaming)
    agent-mcp-client.ts # AgentMCPClient (agent-as-MCP-server via JSON-RPC)
    agent-session.ts    # AgentSession (auth + session lifecycle facade)
    types.ts            # Agent types (SSE events, config, tool defs)
  a2a/
    a2a-client.ts       # A2AClient (A2A protocol, JSON-RPC messaging)
    types.ts            # A2A protocol types
  wallet/
    spending-wallet.ts  # SpendingWallet (HD derivation, USDC signing)
    spending-policy.ts  # 8-layer spending policy enforcement
    balance-checker.ts  # On-chain USDC/ETH balance checks
  mcp/
    canvas-tools.ts     # 7 MCP tool definitions wrapping CanvasClient
    canvas-server.ts    # Stdio MCP server for canvas tools
  cli/
    index.ts            # CLI program setup (commander)
    commands/
      auth.ts           # rickydata auth login|status|logout
      mcp.ts            # rickydata mcp search|enable|disable|tools|call|info|connect
      canvas.ts         # rickydata canvas list|execute|runs|run|import|export
      agents.ts         # rickydata agents list|describe
      chat.ts           # rickydata chat <agent-id>
      sessions.ts       # rickydata sessions list|get|resume|delete
      wallet.ts         # rickydata wallet balance|transactions|settings
      apikey.ts         # rickydata apikey set|status|delete
      config.ts         # rickydata config set|get|list|activate|profiles
      init.ts           # rickydata init (setup wizard)
```

## Key services

| Service         | URL                              | Purpose                              |
|-----------------|----------------------------------|--------------------------------------|
| MCP Gateway     | https://mcp.rickydata.org        | MCP server hosting + tool proxy      |
| Agent Gateway   | https://agents.rickydata.org     | BYOK Claude agents + canvas runtime  |
| Marketplace     | https://mcpmarketplace.rickydata.org | Browse + manage servers          |

## Build and test

```bash
npm run build   # tsc
npm test        # vitest run
```

## Authentication

All authenticated operations use wallet tokens (`mcpwt_` prefix). Login with `rickydata auth login` which opens a browser for sign-in. Tokens are stored in `~/.rickydata/credentials.json` (mode 0600).

## Canvas workflows

Canvas workflows are visual DAGs of nodes (text input, agent, MCP tool, approval gate, GitHub actions, etc.) connected by edges. They execute on the Agent Gateway via SSE streaming.

- CLI: `rickydata canvas list|execute|runs|run|import|export`
- SDK: `CanvasClient.executeWorkflow()` (async generator) or `executeWorkflowSync()`
- MCP: 7 tools via `rickydata mcp canvas-server` (stdio transport)
- Registration: `claude mcp add --transport stdio canvas-workflows rickydata mcp canvas-server`

## Conventions

- All HTTP clients use native `fetch` (Node 18+)
- SSE parsing follows the same pattern across all clients (buffer + double-newline boundary)
- Error classes extend `MCPGatewayError`
- CLI uses `commander` with consistent `--format`, `--profile`, `--gateway` options
- Exports are organized by subpath: `rickydata`, `rickydata/agent`, `rickydata/a2a`, `rickydata/wallet`
