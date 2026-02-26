/**
 * Quick Start: Browse the MCP Gateway
 *
 * No wallet needed - just browse servers and tools.
 *
 * Run: npx tsx examples/quick-start.ts
 */
import { MCPGateway } from '../src/index.js';

const gw = new MCPGateway({ url: 'https://mcp.rickydata.org' });

// List servers
const servers = await gw.listServers();
console.log(`Found ${servers.length} servers (showing first 5):`);
for (const s of servers.slice(0, 5)) {
  console.log(`  ${s.name} — ${s.toolsCount ?? 0} tools`);
}

// Payment config
const config = await gw.getPaymentConfig();
console.log(`\nPayment: ${config.enabled ? 'Enabled' : 'Disabled'} (${config.network})`);
