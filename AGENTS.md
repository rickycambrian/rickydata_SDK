# AGENTS.md

This is the rickydata SDK — a Turborepo monorepo with packages:
- `packages/core` (`rickydata`) — TypeScript SDK and CLI for the MCP Gateway, Agent Gateway, and Canvas Workflow runtime
- `packages/react` (`@rickydata/react`) — React hooks, providers, and inline-styled components
- `packages/chat` (`@rickydata/chat`) — Reusable floating chat bubble with wallet auth, SSE streaming, agent actions, and theming
- `packages/trace` (`@rickydata/trace`) — Trace recorder, viewer, and timeline for agent interactions (Node.js file output + browser memory buffer)

## Ecosystem Context
This SDK is consumed by rickydata_agentbook (mobile app) and external users.
- **mcp_deployments_registry** — SDK calls Agent Gateway (https://agents.rickydata.org) and MCP Gateway (https://mcp.rickydata.org)
- **rickydata_agentbook** — Primary consumer of React hooks and AgentClient

Type changes here require matching updates in mcp_deployments_registry (API contracts) and rickydata_agentbook (hook usage).

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
        agent-client.ts     # AgentClient (BYOK chat, SSE, secrets, voice, wallet, team, retry)
        agent-mcp-client.ts # AgentMCPClient (agent-as-MCP-server)
        agent-session.ts    # AgentSession facade
        session-store.ts    # File-backed session store (~/.rickydata/sessions.json, 24h TTL)
        types.ts            # All agent types + AgentError taxonomy + TeamWorkflowOptions
      a2a/                  # A2A protocol client
      canvas/               # Canvas workflow client + PR review pipeline
      wallet/               # Spending wallet + policy
      pixel/                # Pixel office client
      mcp/
        agent-registry.ts   # Registry CRUD + file watch (~/.rickydata/mcp-agents.json)
        agent-mcp-proxy.ts  # Stdio MCP proxy: dynamic tool aggregation + listChanged
        canvas-server.ts    # Canvas workflow MCP server
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
  chat/                     # npm: @rickydata/chat
    src/
      index.ts              # All public exports
      providers/
        ChatBubbleProvider.tsx # Config context + AgentClient + theme injection
      hooks/
        useChatBubbleEngine.ts # Core SSE chat state machine (uses AgentClient directly)
        useWalletAuth.ts     # Wallet-agnostic gateway auth (challenge/sign/verify)
        useBubble.ts         # Convenience wrapper on bubble store
      stores/
        bubble.ts            # Zustand: isOpen, isMinimized, mode, unreadCount
        actions.ts           # Zustand: pendingActions Map, highlights Map
      adapters/
        custom.ts            # createCustomAdapter(opts)
        privy.ts             # createPrivyAdapter(wallets, auth)
        window-ethereum.ts   # createMetaMaskAdapter()
      components/
        ChatBubble.tsx       # Root: renders Button or Window + HighlightOverlay
        ChatBubbleButton.tsx # FAB with unread badge
        ChatBubbleWindow.tsx # Main window (auth-gated, mode-switched)
        ChatWindowHeader.tsx # Header with mode tabs
        ChatInputBar.tsx     # Textarea + send button
        ChatMessageList.tsx  # Messages + tool badges + action cards
        ActionConfirmationCard.tsx # Confirm/reject agent actions
        ThreadDrawer.tsx     # Thread list
        HighlightOverlay.tsx # Portal-based UI highlight
      theme/
        tokens.ts            # Dark + light CSS variable presets
        inject.ts            # CSS variable injection utility
      types/
        wallet.ts            # WalletAdapter interface
        chat.ts              # ChatMessage, ToolExecution, ChatContext
        thread.ts            # Thread, ThreadListItem
        actions.ts           # ActionProposal, HighlightTarget
        events.ts            # ChatBubbleEvent discriminated union
        theme.ts             # ThemeConfig, ThemeTokens
  trace/                    # npm: @rickydata/trace
    src/
      index.ts              # All public exports
      recorder.ts           # TraceRecorder (Node.js file + browser memory)
      traced-client.ts      # TracedAgentClient (AgentClient wrapper with auto-recording)
      types.ts              # TraceEvent, TraceSession, TraceRecorderConfig
      utils.ts              # generateId, formatTimestamp, isNode
      theme.ts              # Dark theme tokens (CSS custom properties)
      hooks/
        useTraceRecorder.ts # React hook: live-updating events array
      components/
        TraceViewer.tsx     # Scrollable event list with type badges + collapsible detail
        TraceTimeline.tsx   # Compact horizontal timeline with dots/bars
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
| Agent Gateway   | https://agents.rickydata.org     | BYOK Codex agents + canvas runtime  |
| Marketplace     | https://marketplace.rickydata.org | Browse + manage servers          |

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

## Chat package usage

```tsx
import { ChatBubble, ChatBubbleProvider, createCustomAdapter } from '@rickydata/chat';

const wallet = createCustomAdapter({
  getAddress: () => connectedAddress,
  signMessage: (msg) => signer.signMessage(msg),
});

<ChatBubbleProvider config={{
  agentId: 'my-agent',
  wallet,
  title: 'My Assistant',
  theme: { preset: 'dark' },
  callbacks: {
    onAction: async (proposal) => ({ confirmed: true }),
    onNavigate: (path) => router.push(path),
  },
}}>
  <ChatBubble />
</ChatBubbleProvider>
```

Key design decisions:
- **WalletAdapter pattern**: Plain object interface, not hooks. Decouples from Privy/MetaMask/etc.
- **AgentClient direct**: Uses `AgentClient.createSession()` + `chatRaw()` + `streamSSEEvents()` — no backend proxy needed
- **CSS custom properties**: Components use `var(--chat-*)` tokens. No Tailwind dependency.
- **Zustand stores**: `useChatBubble` and `useAgentActions` accessible via `.getState()` outside React

## Dynamic Agent Proxy

The agent proxy lets users enable/disable agents as MCP tool providers in Codex without restart:

```bash
rickydata init                                        # Full setup (includes proxy registration)
rickydata mcp proxy-connect                           # Register proxy with Codex (one-time)
rickydata mcp agent enable <agent-id>                 # Tools appear instantly
rickydata mcp agent disable <agent-id>                # Tools vanish instantly
rickydata mcp agent list                              # Show enabled agents
```

Architecture: single stdio proxy registered once with Codex. It watches `~/.rickydata/mcp-agents.json` and sends `notifications/tools/list_changed` to hot-swap tools.

## PR Review System (`@rickydata review`)

Comment `@rickydata review` on any PR to trigger a multi-agent team review via GitHub Actions.

**How it works:**
1. `.github/workflows/rickydata-review.yml` fires on `issue_comment` events containing `@rickydata review`
2. The workflow fetches the PR diff, then runs `rickydata github review owner/repo#N --diff-file /tmp/pr.diff --json`
3. A canvas workflow (`buildPRReviewWorkflow`) orchestrates 6 specialist agents: security, correctness, performance, test_coverage, style, architecture
4. Results are parsed and posted as inline PR review comments with severity indicators

**Auth:** GitHub OIDC — the workflow requests an Actions OIDC token (`permissions: id-token: write`), which `AuthManager.authenticateWithGitHubOIDC()` exchanges at `/auth/github/exchange` for a session token. No stored secrets needed beyond `GITHUB_TOKEN`.

**Workflow modes:**
- `direct` (default) — embeds the diff in the canvas text-input node; no GitHub App installation required on the target repo
- `github-repo` — adds a `github-repo` node so the server fetches repo context itself

**Pipeline:** `buildPRReviewWorkflow` (build) → `parseCanvasReviewResult` (extract JSON findings from SSE/results) → `formatGitHubReview` (produce `GitHubReviewPayload` with inline comments)

**CLI:**
```bash
rickydata github review owner/repo#42                    # Stream review to terminal
rickydata github review owner/repo#42 --json             # JSON output (used by CI)
rickydata github review owner/repo#42 --diff-file f.diff # Use local diff (direct mode)
rickydata github review owner/repo#42 --post-github      # Parse + format as GitHub review
rickydata github review-status <run-id>                  # Check async run status
```

**Key files:**
- `canvas/pr-review-workflow.ts` — workflow builder (nodes, connections, team runtime)
- `canvas/parse-review-results.ts` — extracts `ReviewFinding[]` from canvas results/SSE events
- `canvas/format-github-review.ts` — converts findings to `GitHubReviewPayload` (inline comments + summary)
- `cli/commands/github.ts` — CLI commands (`review`, `review-status`)
- `auth.ts` — `authenticateWithGitHubOIDC()`, `isGitHubActions`, `getGitHubOIDCToken()`

## Skills & Sub-agents

| Skill | When to Use | Invocation |
|-------|-------------|------------|
| `review-pr` | Run multi-agent PR review | `/review-pr owner/repo#N` |
| `verify-deployment` | Create/run post-deploy verification | `/verify-deployment [repo-or-url]` |
| `verification-analysis` | Predict, remediate, dashboard for verification system | `/verification-analysis [predict\|remediate\|dashboard\|full]` |
| `canvas-execute` | Execute a canvas workflow | `/canvas-execute <file-or-id>` |
| `mcp-search` | Search MCP marketplace | `/mcp-search <query>` |
| `improvement-cycle` | Run 8-stage verification improvement pipeline | `/improvement-cycle` |
| `Codex-agent-setup` | Agent + MCP setup patterns for Codex sessions, free-tier model resolution | (manual reference) |
| `sdk-resilience-patterns` | Reference for error taxonomy, retry, persistence, timeout patterns | (manual reference) |
| `canvas-client-patterns` | Canvas SSE timeout/heartbeat, CanvasHttpError, getRunWithRetry, ParseFailureReason | (manual reference) |
| `wallet-adapter-pattern` | Building wallet-agnostic auth adapters bridging Privy/MetaMask to WalletAdapter interface | (manual reference) |
| `external-engine-pattern` | Decoupling SDK UI from SDK networking by accepting an external chat engine from the host app | (manual reference) |
| `execution-trace-recording` | Dual-env trace recording (Node.js JSONL files + browser in-memory), TracedAgentClient wrapper, SSE event mapping | (manual reference) |
| `trace-viewer-component` | TraceViewer scrollable event list, TraceTimeline SVG visualization, useTraceRecorder hook, CSS custom property theming | (manual reference) |

| Agent | Purpose |
|-------|---------|
| `canvas-workflow-helper` | Create/inspect/debug canvas workflows (incl. PR review workflow pattern) |
| `sdk-explorer` | Explore SDK architecture and find API methods |

## Research-Driven Improvement

| Skill | When to Use | Invocation |
|-------|-------------|------------|
| `research-improve` | Find research-backed codebase improvements | `/research-improve [focus]` |
| `research-improve-team` | Agent team mode (uses TeamCreate/SendMessage, NOT sub-agents) | `/research-improve-team [focus]` |
| `implement-research-plan` | Execute top items from a synthesized research plan | `/implement-research-plan [item#]` |

| Agent | Purpose |
|-------|---------|
| `codebase-explorer` | Deep repo exploration for gaps and architecture |
| `paper-discoverer` | Find relevant academic papers via MCP research agent |
| `research-synthesizer` | Cross-reference research with codebase gaps |
| `docs-expert` | Record verified working patterns as skills |

**Prerequisite**: `rickydata-proxy` MCP server must be connected (`rickydata mcp proxy-connect`).

**Agent Teams Note**: `/research-improve-team` uses `TeamCreate` + `Agent(name: "X", team_name: "T")` to create persistent teammates that communicate via `SendMessage`. Do NOT use `Agent(subagent_type: "X")` for team mode — that creates disposable sub-agents. See `.Codex/docs/agent-teams-reference.md` for the full API.

## Conventions

- All HTTP clients use native `fetch` (Node 18+)
- SSE parsing follows the same pattern across all clients
- Standalone parsers: `streamSSEEvents()`, `streamTeamSSEEvents()`, `buildTeamWorkflowPayload()`
- Exports organized by subpath: `rickydata`, `rickydata/agent`, `rickydata/a2a`, etc.
- React hooks use React Query for data fetching, useState for SSE streaming
- Components use inline styles (no CSS framework dependency)
- Errors use `AgentError` with typed `AgentErrorCode` — use `AgentError.fromHttpStatus()` at HTTP boundaries
- Retry logic via `retryWithBackoff()` — only retries `isRetryable` errors; pass `maxRetries: 0` in tests
- File-backed stores accept `null` path for in-memory test mode (e.g., `sessionStorePath: null`)
- Canvas HTTP errors use `CanvasHttpError(status, message)` — enables typed status-code checks (e.g., 404 in `getRunWithRetry`)
- Canvas SSE streams accept `ExecuteWorkflowOptions` with `timeoutMs` + `heartbeatTimeoutMs` — both optional, compose with caller `AbortSignal`
- `parseCanvasReviewResult` returns `parseWarning?.reason: ParseFailureReason` on empty findings — check it before assuming no issues found
