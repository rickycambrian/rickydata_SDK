---
name: Codex-agent-setup
description: Verified patterns for setting up rickydata agents and MCP servers in Codex sessions. Covers free-tier model resolution, agent enabling via proxy, wallet settings alignment, and the two MCP paths (chat routes vs agent-mcp-routes). Use when configuring agents for Codex or debugging model/API key errors.
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash
---

# Codex Agent Setup Reference

Verified working 2026-03-30 (824 SDK tests pass, 4693 gateway tests pass, erc8004-expert agent confirmed via free tier through all paths).

## Quick Start — Enable an Agent in Codex

```bash
# 1. Authenticate (if not already)
rickydata init                              # Full wizard (auth + MCP + proxy)

# 2. Enable an agent (tools appear instantly via proxy)
rickydata mcp agent enable <agent-id>       # e.g., erc8004-expert

# 3. Use the agent's tools in Codex
# Tools appear as: mcp__rickydata-proxy__<agent-id>__<tool_name>
```

## Two MCP Paths — Critical Difference

| Path | Endpoint | Free Tier | API Key Required |
|------|----------|-----------|-----------------|
| **Chat routes** (`/agents/{id}/sessions/{sid}/chat`) | Agent Gateway | Yes (MiniMax-M2.7-highspeed) | No (free plan uses platform key) |
| **Agent MCP routes** (`/agents/{id}/mcp`) | Agent Gateway | Yes (since 2026-03-30 fix) | No (free plan uses platform key) |

The rickydata-proxy (stdio) uses the **Agent MCP routes** path. The rickydata MCP server (HTTP) uses the **Chat routes** path.

### All Paths Work on Free Tier (as of 2026-03-30)

- `rickydata chat <agent-id>` — CLI chat via chat routes
- `mcp__rickydata-proxy__<agent-id>__agent_chat` — Codex proxy via agent MCP routes
- `mcp__rickydata__agent_chat` — main MCP server via chat routes
- Direct `AgentClient.chat()` — programmatic access via chat routes

All paths now support free-tier users without API keys. The agent MCP endpoint was fixed to mirror the same free-tier fallback pattern from `chat-routes.ts`.

## Model Resolution for Free Tier (SDK Fix — 2026-03-29)

The `resolveModel()` function in `cli/commands/chat.ts` resolves models using this cascade:

```
1. Explicit --model flag → use it
2. plan === 'free' → getFreeTierStatus().model || 'MiniMax-M2.7'
3. plan === 'byok' → settings.defaultModel || 'haiku'
4. plan undefined + no API key → free tier (MiniMax-M2.7)
5. plan undefined + API key configured → settings.defaultModel || 'haiku'
6. Settings unavailable + no API key → MiniMax-M2.7
```

**Critical**: Model string MUST start with `'MiniMax'` (title case). Lowercase `'minimax'` does NOT match the backend's `isRequestingAnthropic` gate. The constant `FREE_TIER_MODEL = 'MiniMax-M2.7'` in `agent/types.ts` ensures this.

### Auto-Fix Settings Mismatch

When `plan === 'free'` but `modelProvider !== 'minimax'`, the SDK auto-updates wallet settings:
```typescript
client.updateWalletSettings({ modelProvider: 'minimax', defaultModel: FREE_TIER_MODEL })
```

This prevents the agent-mcp-routes from erroring with "Anthropic API key required" when the MCP proxy is used.

## Wallet Settings for Free Tier

| Setting | Correct Value | Why |
|---------|--------------|-----|
| `plan` | `'free'` | Triggers free-tier routing in chat-routes |
| `modelProvider` | `'minimax'` | Agent MCP routes check this to decide which key to require |
| `defaultModel` | `'MiniMax-M2.7-highspeed'` | Backend forces this for free tier, but settings should match |

Set via CLI:
```bash
rickydata wallet settings set defaultModel MiniMax-M2.7-highspeed
rickydata wallet settings set modelProvider minimax     # Added 2026-03-29
rickydata wallet settings set plan free                 # Added 2026-03-29
```

## rickydata MCP Server — HTTP Transport Initialization

The rickydata HTTP MCP server at `rickydata-mcp-server-*.a.run.app/mcp` requires the full MCP initialization handshake:

1. `initialize` request → server responds with capabilities + `Mcp-Session-Id` header
2. `notifications/initialized` notification (with session ID) → server marks session ready
3. Tool calls work

**Known issue**: Codex's HTTP Streamable transport may not send the `notifications/initialized` notification, causing "Server not initialized" errors. The server IS reachable (curl works). Workaround: use a stdio bridge or call the chat API directly.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/agent/types.ts` | `FREE_TIER_MODEL` constant |
| `packages/core/src/cli/commands/chat.ts` | `resolveModel()` — model resolution with free-tier cascade |
| `packages/core/src/cli/chat/chat-repl.ts` | Chat REPL with minimax support + error recovery |
| `packages/core/src/cli/commands/wallet.ts` | `ALLOWED_SETTINGS_KEYS` — includes `modelProvider`, `plan` |
| `packages/core/src/cli/commands/init.ts` | Init messaging (free tier works immediately) |
| `packages/core/src/mcp/agent-mcp-proxy.ts` | Stdio proxy (uses agent MCP routes, no free tier) |
| `packages/core/src/mcp/agent-registry.ts` | `~/.rickydata/mcp-agents.json` management |

## Error Recovery in Chat REPL

When users hit API key errors, the REPL now suggests:
```
This may be a model/API key mismatch. Try one of:
  /model minimax       Switch to free-tier model (no API key needed)
  rickydata apikey set  Configure your Anthropic API key for haiku/sonnet/opus
```

Detected patterns: `missing_secrets`, `api key`, `402`, `payment required`, `rate_limited`.
