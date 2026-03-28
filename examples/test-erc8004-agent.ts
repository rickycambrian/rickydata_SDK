/**
 * ERC-8004 Agent End-to-End Test
 * Tests KFDB tools via the marketplace agent gateway.
 *
 * Run: PRIVATE_KEY=0x... npx tsx examples/test-erc8004-agent.ts
 */

import { AgentClient } from '../src/agent/agent-client.js';

async function main() {
  const client = new AgentClient({
    privateKey: process.env.PRIVATE_KEY!,
    gatewayUrl: 'https://agents.rickydata.org',
  });

  console.log('Testing erc8004-expert KFDB tools...\n');

  // Test 1: Ecosystem stats
  console.log('=== Test 1: kfdb_ecosystem_stats ===');
  try {
    const r1 = await client.chat('erc8004-expert', 'Use the kfdb_ecosystem_stats tool to get ERC-8004 stats.', {
      model: 'haiku',
      maxToolCalls: 2,
      onToolCall: (t: any) => console.log(`  [tool] ${t.displayName || t.name}`),
    });
    console.log(r1.text.slice(0, 400));
    console.log(`  Cost: ${r1.cost}\n`);
  } catch (e: any) {
    console.error(`  FAILED: ${e.message}\n`);
  }

  // Test 2: Agent details via KQL
  console.log('=== Test 2: kfdb_get_agent_details ===');
  try {
    const r2 = await client.chat('erc8004-expert', 'Use kfdb_get_agent_details to get details for agent 8453:1.', {
      model: 'haiku',
      maxToolCalls: 2,
      onToolCall: (t: any) => console.log(`  [tool] ${t.displayName || t.name}`),
    });
    console.log(r2.text.slice(0, 400));
    console.log(`  Cost: ${r2.cost}\n`);
  } catch (e: any) {
    console.error(`  FAILED: ${e.message}\n`);
  }

  // Test 3: Feedback analysis via KQL
  console.log('=== Test 3: kfdb_feedback_analysis ===');
  try {
    const r3 = await client.chat('erc8004-expert', 'Use kfdb_feedback_analysis to analyze feedback for agent 8453:1.', {
      model: 'haiku',
      maxToolCalls: 2,
      onToolCall: (t: any) => console.log(`  [tool] ${t.displayName || t.name}`),
    });
    console.log(r3.text.slice(0, 400));
    console.log(`  Cost: ${r3.cost}\n`);
  } catch (e: any) {
    console.error(`  FAILED: ${e.message}\n`);
  }

  console.log('=== All tests complete ===');
}

main().catch(console.error);
