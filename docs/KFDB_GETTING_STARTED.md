# KFDB Getting Started

Connect your wallet and start using KnowledgeFlow DB — a knowledge graph database with 200+ tools — through the MCP marketplace. No API keys, no infrastructure, no setup.

## How It Works

KFDB is available as a remote MCP server in the RickyData marketplace. When you connect your wallet, a private tenant is automatically provisioned for you with:

- **10,000 nodes** and **100,000 edges** storage quota
- **1 GB** total data limit
- **KQL and SQL** query languages
- **Semantic search** with vector embeddings
- **Global + private scopes** — shared global graph reads, private tenant writes
- **Full isolation** — your data is completely separate from other users

Your wallet address is your identity. No API keys to manage, no secrets to store.

## Quick Start

### 1. Install the CLI

```bash
npm install -g @rickydata/core
```

### 2. Authenticate with Your Wallet

```bash
rickydata auth login
```

This opens a browser window where you sign a message with your wallet (MetaMask, WalletConnect, etc.). Once signed, you get a session token that authenticates all CLI commands.

### 3. Check Your KFDB Status

```bash
rickydata kfdb status
```

This shows your local config, marketplace tenant info, and usage vs quota.

### 4. Enable KFDB in the Marketplace

```bash
rickydata mcp enable knowledgeflow-db
```

Or search for it:

```bash
rickydata mcp search knowledgeflow
```

### 5. Call KFDB Tools

```bash
# Execute a KQL query
rickydata mcp call knowledgeflow-db execute_kql \
  --args '{"query": "MATCH (n) RETURN COUNT(n) AS total"}'

# Write data to your private tenant
rickydata mcp call knowledgeflow-db write_data \
  --args '{"operations": [{"operation": "create_node", "label": "Note", "properties": {"title": {"String": "My first note"}, "content": {"String": "Hello from KFDB!"}}}]}'

# Query your data back
rickydata mcp call knowledgeflow-db execute_kql \
  --args '{"query": "MATCH (n:Note) RETURN n.title, n.content"}'

# Check your tenant usage
rickydata mcp call knowledgeflow-db tenant_status
```

Each tool call costs $0.0005 USDC (Base network) via x402 payment.

## Using KFDB from AI Agents

KFDB tools are available to any MCP-compatible AI agent. In Claude Desktop or Cursor, add the RickyData MCP gateway:

```json
{
  "mcpServers": {
    "rickydata": {
      "url": "https://mcp.rickydata.org/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Then ask your agent to search for and enable KFDB:

> "Search for knowledgeflow-db in the marketplace and enable it. Then create a Note node with title 'Meeting Notes' and content 'Discussed Q2 roadmap'."

The agent will use the `gateway__search_servers` and `gateway__enable_server` meta-tools, then call `knowledgeflow-db__write_data` to create the node.

## Available Tools

KFDB exposes 200+ tools through the marketplace. Key categories:

| Category | Tools | Examples |
|----------|-------|---------|
| **Query** | `execute_kql`, `execute_sql` | Graph pattern matching, SQL queries |
| **Write** | `write_data`, `bulk_upload_json` | Create nodes, edges, bulk import |
| **Search** | `semantic_search`, `code_search`, `full_text_search` | Vector search, multi-stream code search |
| **Graph** | `get_graph_schema`, `get_stats`, `get_ego_graph` | Schema inspection, graph analytics |
| **Notes** | `create_note`, `get_note`, `publish_note` | Knowledge management |
| **Import** | `import_github_repo` | Import GitHub repos with AST extraction |
| **Tenant** | `tenant_status` | Check usage and quota |
| **Workflows** | `run_saved_canvas_workflow` | Execute automation workflows |

## Data Model

KFDB stores data as a property graph:

- **Nodes** have a label (type) and properties
- **Edges** connect nodes with a type and optional properties
- **Properties** use typed wrappers: `{"String": "value"}`, `{"Integer": 42}`, `{"Boolean": true}`, `{"Float": 3.14}`

Example — creating a project with files:

```bash
# Create a project node
rickydata mcp call knowledgeflow-db write_data --args '{
  "operations": [
    {
      "operation": "create_node",
      "label": "Project",
      "properties": {
        "name": {"String": "my-app"},
        "language": {"String": "TypeScript"}
      }
    }
  ]
}'

# Create a file node and link it to the project
rickydata mcp call knowledgeflow-db write_data --args '{
  "operations": [
    {
      "operation": "create_node",
      "label": "File",
      "properties": {
        "path": {"String": "src/index.ts"},
        "size": {"Integer": 1024}
      }
    },
    {
      "operation": "create_edge",
      "edge_type": "CONTAINS",
      "from_label": "Project",
      "to_label": "File",
      "match_property": "name",
      "match_value": "my-app",
      "properties": {}
    }
  ]
}'
```

## Quotas and Limits

| Resource | Free Tier |
|----------|-----------|
| Nodes | 10,000 |
| Edges | 100,000 |
| Storage | 1 GB |
| Queries per minute | 60 |

Writes that exceed your quota are rejected with a clear error message. Use `tenant_status` to check current usage.

## Direct API Access

For advanced use, you can access KFDB directly with the TypeScript SDK:

```bash
npm install rickydata
```

```typescript
import { KFDBClient } from 'rickydata';

const kfdb = new KFDBClient({
  baseUrl: 'http://34.60.37.158',
  apiKey: 'your-api-key', // from rickydata kfdb init
  // defaultReadScope is "global" if omitted
});

// Global read (default)
const marketplaceServers = await kfdb.listEntities('MCPServer', { limit: 10 });

// Private read using scoped client
const privateNotes = await kfdb.withScope('private').listEntities('Note', { limit: 10 });

// Per-call override (beats client default)
const privateTasks = await kfdb.listEntities('Task', { scope: 'private', limit: 20 });

// Writes always use tenant-scoped /api/v1/write
await kfdb.write({
  operations: [
    {
      operation: 'create_node',
      label: 'Note',
      properties: {
        title: { String: 'SDK note' },
      },
    },
  ],
});
```

Scope model:
- Reads (`listLabels`, `listEntities`, `getEntity`, `filterEntities`, `batchGetEntities`) support `global` and `private`.
- Writes (`write`) are always tenant-isolated.

Run `rickydata kfdb init` to configure direct API access with an API key.

## Next Steps

- **Import a GitHub repo**: `rickydata mcp call knowledgeflow-db import_github_repo --args '{"url": "https://github.com/owner/repo"}'`
- **Semantic search**: `rickydata mcp call knowledgeflow-db semantic_search --args '{"query": "authentication middleware"}'`
- **Run workflows**: Explore Canvas workflows for automation
- **Check the API docs**: `rickydata mcp call knowledgeflow-db get_docs --args '{"topic": "kql"}'`
