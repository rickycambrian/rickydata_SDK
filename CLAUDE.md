# CLAUDE.md

This is the rickydata SDK — a Turborepo monorepo with two packages:
- `packages/core` (`rickydata`) — TypeScript SDK and CLI for the MCP Gateway, Agent Gateway, and Canvas Workflow runtime
- `packages/react` (`@rickydata/react`) — React hooks, providers, and inline-styled components

## Monorepo structure

```
packages/
  core/                     # npm: rickydata
    src/
      index.ts              # Public SDK exports
      client.ts             # MCPGateway class
      auth.ts               # AuthManager
      constants.ts          # Chain IDs, USDC, spending defaults
      agent/
        agent-client.ts     # AgentClient (BYOK chat, SSE, secrets, voice, wallet, team)
        agent-mcp-client.ts # AgentMCPClient (agent-as-MCP-server)
        agent-session.ts    # AgentSession facade
        types.ts            # All agent types
      a2a/                  # A2A protocol client
      canvas/               # Canvas workflow client
      wallet/               # Spending wallet + policy
      pixel/                # Pixel office client
      mcp/                  # MCP server tools
      cli/                  # CLI commands
    tests/                  # vitest tests
    bin/                    # CLI entry points
  react/                    # npm: @rickydata/react
    src/
      index.ts              # All public exports
      providers/
        RickyDataProvider.tsx  # Context + AgentClient provider
      hooks/
        agents.ts           # useAgents, useAgent (React Query)
        apikey.ts           # useApiKeyStatus, useSetApiKey
        balance.ts          # useWalletBalance, useWalletTransactions
        sessions.ts         # useSessions, useSession
        wallet-settings.ts  # useWalletSettings
        secrets.ts          # useSecrets (discovers missing secrets)
        chat.ts             # useAgentChat (SSE streaming, useState-based)
      components/
        SecretForm.tsx       # Generic password form (inline styles)
        SecretOrchestrator.tsx # Discovers + renders missing secrets
        WalletChip.tsx       # Compact wallet identity pill
      types.ts              # ChatMessage, ToolExecution, SecretSection
```

## Build and test

```bash
npm run build           # turbo build (both packages)
npm run build:core      # core only
npm run build:react     # react only
npm test                # turbo test (core tests)
```

## Key services

| Service         | URL                              | Purpose                              |
|-----------------|----------------------------------|--------------------------------------|
| MCP Gateway     | https://mcp.rickydata.org        | MCP server hosting + tool proxy      |
| Agent Gateway   | https://agents.rickydata.org     | BYOK Claude agents + canvas runtime  |
| Marketplace     | https://mcpmarketplace.rickydata.org | Browse + manage servers          |

## Authentication

All authenticated operations use wallet tokens (`mcpwt_` prefix). The core SDK supports three auth modes:
- `privateKey` — wallet signing (Node.js / CLI)
- `token` — pre-existing JWT
- `tokenGetter` — async function for browser/React use (new in 1.1.0)

## React package usage

```tsx
import { RickyDataProvider, useAgentChat, useWalletBalance } from '@rickydata/react';

<QueryClientProvider client={queryClient}>
  <RickyDataProvider config={{ getAuthToken: () => getToken() }}>
    <App />
  </RickyDataProvider>
</QueryClientProvider>
```

## Conventions

- All HTTP clients use native `fetch` (Node 18+)
- SSE parsing follows the same pattern across all clients
- Standalone parsers: `streamSSEEvents()`, `streamTeamSSEEvents()`, `buildTeamWorkflowPayload()`
- Exports organized by subpath: `rickydata`, `rickydata/agent`, `rickydata/a2a`, etc.
- React hooks use React Query for data fetching, useState for SSE streaming
- Components use inline styles (no CSS framework dependency)
