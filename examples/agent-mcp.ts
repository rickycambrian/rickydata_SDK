/**
 * Agent-as-MCP Example
 *
 * Shows how to use AgentMCPClient to connect to an agent's MCP endpoint,
 * list its tools, and call one.
 *
 * Each agent on the gateway exposes its skills as standard MCP tools.
 *
 * Setup:
 *   export PRIVATE_KEY=0x...   # Wallet private key
 *
 * Run: npx tsx examples/agent-mcp.ts
 */

import { AgentMCPClient } from '../src/agent/agent-mcp-client.js';

const agentId = process.argv[2] || 'mcp-explorer';

const client = new AgentMCPClient({ privateKey: process.env.PRIVATE_KEY! });

// 1. Connect (initialize MCP session)
const info = await client.connect(agentId);
console.log(`Connected to ${info.serverInfo.name} v${info.serverInfo.version}`);
console.log(`Protocol: ${info.protocolVersion}\n`);

// 2. List available tools
const tools = await client.listTools(agentId);
console.log(`Available tools (${tools.length}):`);
for (const tool of tools) {
  console.log(`  - ${tool.name}: ${tool.description ?? '(no description)'}`);
}

// 3. Call a tool (if any available)
if (tools.length > 0) {
  const toolName = tools[0].name;
  console.log(`\nCalling tool: ${toolName}...`);

  const result = await client.callTool(agentId, toolName);
  console.log('Result:');
  for (const part of result.content) {
    console.log(`  [${part.type}] ${part.text.slice(0, 200)}${part.text.length > 200 ? '...' : ''}`);
  }
  if (result.isError) {
    console.log('  (tool returned an error)');
  }
}
