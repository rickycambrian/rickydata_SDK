# Ecosystem Architecture

## Repository relationships

The rickydata ecosystem spans multiple repositories that work together:

### rickydata_SDK (this repo)
**Role:** Client SDK + CLI + MCP tools (consumer of platform APIs)

- TypeScript SDK with subpath exports (`rickydata`, `rickydata/agent`, `rickydata/a2a`, `rickydata/wallet`)
- CLI tool (`rickydata`) for auth, MCP operations, agent chat, canvas workflows
- Canvas MCP server for Claude Code integration (`rickydata mcp canvas-server`)
- Published as `rickydata` on npm

### mcp_deployments_registry
**Role:** Agent Gateway with canvas execution runtime + MCP Gateway + Marketplace

- Hosts the MCP Gateway at `https://mcp.rickydata.org` (MCP server proxying, tool calls, x402 payments)
- Hosts the Agent Gateway at `https://agents.rickydata.org` (BYOK Claude agents, canvas runtime)
- Canvas workflow execution engine: receives workflow DAGs, runs nodes in topological order, streams SSE events
- Node types: TextInput, Agent, MCPTool, AgentTeamOrchestrator, AgentTeamTeammate, ApprovalGate, GitHub* nodes, BrowserVerify
- Wallet token auth, x402 payment verification, USDC on Base mainnet
- Geo protocol storage for persisted workflows

### canvas-workflows
**Role:** Visual workflow builder UI

- React component library published as `@rickycambrian/canvas-workflows-react`
- React Flow-based canvas editor for building workflow DAGs
- Node palette with drag-and-drop, edge connections, live preview
- Exports/imports `.canvas.json` portable workflow format
- Connects to Agent Gateway for execution

### KF_serverless
**Role:** Workspace app embedding canvas

- Hosts `workspace.rickydata.org`
- Embeds the canvas-workflows React component
- Provides workspace-level auth, project management, team features

### geo_mcp_server
**Role:** Geo protocol MCP tools

- MCP server exposing Geo protocol operations (entity CRUD, spatial queries)
- Used by agents and workflows for persistent data storage
- Canvas workflows are stored as Geo entities

## Data flow

```
User (CLI/Browser)
  |
  v
rickydata CLI / canvas-workflows UI
  |
  v
Agent Gateway (mcp_deployments_registry)
  |-- Canvas runtime: execute workflow DAGs via SSE
  |-- Agent sessions: BYOK Claude chat
  |-- MCP Gateway: proxy tool calls to 5000+ servers
  |
  v
Geo Protocol (geo_mcp_server)
  |-- Workflow storage
  |-- Entity persistence
```

## Canvas workflow execution flow

1. User designs workflow in canvas-workflows UI or writes `.canvas.json`
2. Workflow is saved to Geo via Agent Gateway (`POST /canvas/workflows`)
3. Execution request sent (`POST /canvas/workflows/execute/stream`)
4. Agent Gateway runs nodes in topological order, streaming SSE events
5. Each node type has its own executor (agent nodes call Claude, MCP nodes call tools, etc.)
6. Approval gates pause execution until approved/rejected
7. Final `run_completed` or `run_failed` event contains aggregated results

## Authentication model

All services share the wallet token (`mcpwt_`) authentication:
- Browser login at `https://agents.rickydata.org/auth/login` (email, Google, GitHub, Discord, Web3)
- Produces `mcpwt_` token valid for 30 days
- Token works across MCP Gateway, Agent Gateway, and canvas endpoints
- Stored in `~/.rickydata/credentials.json`
