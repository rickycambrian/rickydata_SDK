# Dynamic MCP Agent Loading

Zero-restart agent management for Claude Code. Enable or disable agents as MCP tool providers without restarting your session.

## One-time Setup

Register the dynamic agent proxy with Claude Code:

```bash
rickydata mcp proxy-connect
```

This registers a single persistent stdio MCP server (`rickydata-proxy`) that aggregates tools from all enabled agents. Restart Claude Code once after running this command.

## Usage

### Enable an agent

```bash
rickydata mcp agent enable <agent-id>
```

The proxy verifies the agent exists, adds it to the registry, and Claude Code picks up the new tools automatically — no restart or `/mcp reconnect` needed.

### Disable an agent

```bash
rickydata mcp agent disable <agent-id>
```

Tools are removed from Claude Code automatically.

### List enabled agents

```bash
rickydata mcp agent list
rickydata mcp agent list --format json
```

## How It Works

```
Claude Code ←──stdio──→ rickydata-proxy (persistent process)
                              │
                              ├── watches ~/.rickydata/mcp-agents.json
                              │
                              ├── Agent Gateway (HTTP+SSE)
                              │     ├── agent-1/mcp → tools/list, tools/call
                              │     ├── agent-2/mcp → tools/list, tools/call
                              │     └── ...
                              │
                              └── sends notifications/tools/list_changed
                                   when registry changes
```

The proxy server:
1. Declares `{ tools: { listChanged: true } }` during MCP initialization
2. Watches `~/.rickydata/mcp-agents.json` for changes (with 500ms debounce)
3. When the registry changes, re-fetches agent tools and diffs against the cache
4. If tools changed, sends `notifications/tools/list_changed` to Claude Code
5. Claude Code automatically re-fetches `tools/list` and updates available tools

Tools are namespaced as `{agent-slug}__{tool_name}` (e.g., `research-agent__web_search`) to avoid collisions between agents.

## Old vs New Flow

### Before (per-agent HTTP mount)

Each agent required a separate entry in `~/.claude.json` and a Claude Code restart:

```bash
# For each agent:
claude mcp add --transport http agent-name https://agents.rickydata.org/agents/<id>/mcp
# Restart Claude Code to pick up changes
```

### After (dynamic proxy)

One-time setup, then instant enable/disable:

```bash
# One-time:
rickydata mcp proxy-connect
# Restart Claude Code once

# Then, anytime:
rickydata mcp agent enable my-agent    # tools appear instantly
rickydata mcp agent disable my-agent   # tools vanish instantly
```
