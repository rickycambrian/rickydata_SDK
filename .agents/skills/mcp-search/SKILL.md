---
name: mcp-search
description: Search for MCP servers on the marketplace and enable them. Use when looking for tools, MCP servers, or wanting to enable/disable servers.
allowed-tools: Bash
---

Search the MCP marketplace and manage servers using the rickydata CLI.

## Search for servers

```bash
rickydata mcp search "$ARGUMENTS"
```

## Enable a server

```bash
rickydata mcp enable <server-name-or-id>
```

## Disable a server

```bash
rickydata mcp disable <server-name-or-id>
```

## List enabled tools

```bash
rickydata mcp tools
```

## Call a tool directly

```bash
rickydata mcp call <tool-name> '{"param": "value"}'
```

## Get server details

```bash
rickydata mcp info <server-name-or-id>
```
