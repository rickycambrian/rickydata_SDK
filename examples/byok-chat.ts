/**
 * BYOK (Bring Your Own Key) Chat Example
 *
 * Shows how to use the A2A client with your own Anthropic API key.
 * The gateway charges only a 10% platform fee instead of the full LLM cost.
 *
 * Setup: Create a .env file with:
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   AGENT_GATEWAY_URL=https://agents.rickydata.org
 *   AUTH_TOKEN=<your wallet-auth token (mcpwt_...)>
 *
 * Run: npx tsx examples/byok-chat.ts
 */

import { A2AClient } from '../src/a2a/a2a-client.js';
import type { TaskCost } from '../src/a2a/types.js';

const baseUrl = process.env.AGENT_GATEWAY_URL || 'https://agents.rickydata.org';
const token = process.env.AUTH_TOKEN;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

if (!token) {
  console.error('AUTH_TOKEN required. Create a wallet-auth token (mcpwt_...) first.');
  process.exit(1);
}

if (!anthropicApiKey) {
  console.error('ANTHROPIC_API_KEY required. Get one from console.anthropic.com');
  process.exit(1);
}

async function main() {
  const client = new A2AClient({
    baseUrl,
    token,
    anthropicApiKey,
  });

  // Store API key in gateway vault (encrypted in-memory)
  console.log('Storing API key in gateway vault...');
  const stored = await client.storeApiKey(anthropicApiKey!);
  console.log('Key configured:', stored.configured);

  // Send a message — the gateway uses YOUR key for Claude API calls
  // and charges only a 10% markup on the LLM cost
  console.log('\nSending message (BYOK mode)...');
  const task = await client.sendMessage({
    message: {
      role: 'user',
      parts: [{ type: 'text', text: 'What is the capital of France?' }],
    },
    metadata: { agentId: 'general-purpose' },
  });

  // Show response
  const textParts = task.artifacts?.flatMap(a =>
    a.parts.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text)
  ) || [];
  console.log('\nResponse:', textParts.join(''));

  // Show cost breakdown — only the platform markup, not full LLM cost
  const cost = task.metadata?.cost as TaskCost | undefined;
  if (cost) {
    console.log(`\nCost breakdown (BYOK = ${cost.byok ?? false}):`);
    console.log(`  Platform fee: $${(Number(cost.total) / 1_000_000).toFixed(6)}`);
    console.log(`  LLM markup:   $${(Number(cost.llm) / 1_000_000).toFixed(6)}`);
    console.log(`  Tool costs:   $${(Number(cost.tools) / 1_000_000).toFixed(6)}`);
  }
}

main().catch(console.error);
