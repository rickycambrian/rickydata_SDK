/**
 * Agent Chat Example
 *
 * Shows how to use the AgentClient for a simple chat interaction.
 *
 * Setup:
 *   export PRIVATE_KEY=0x...   # Wallet private key
 *   # Optional: export ANTHROPIC_API_KEY=sk-ant-...  # For BYOK mode
 *
 * Run: npx tsx examples/agent-chat.ts
 */

import { AgentClient } from '../src/agent/agent-client.js';

const client = new AgentClient({ privateKey: process.env.PRIVATE_KEY! });

// Optional: configure BYOK for lower costs (10% markup only)
if (process.env.ANTHROPIC_API_KEY) {
  await client.configureApiKey(process.env.ANTHROPIC_API_KEY);
  console.log('BYOK mode enabled\n');
}

const result = await client.chat('research-agent', 'What are the top 3 MCP servers for database access?', {
  model: 'haiku',
  onToolCall: (t) => console.log(`  [tool] ${t.displayName || t.name}`),
  onText: (t) => process.stdout.write(t),
});

console.log(`\nCost: ${result.cost}, Tools: ${result.toolCallCount}`);
