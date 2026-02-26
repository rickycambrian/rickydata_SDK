/**
 * Wallet Token Authentication
 *
 * Creates a long-lived, self-verifying wallet token (mcpwt_) that
 * survives gateway restarts and requires zero server-side storage.
 *
 * Run: PRIVATE_KEY=0x... npx tsx examples/wallet-token.ts
 */
import { privateKeyToAccount } from 'viem/accounts';
import { MCPGateway, createWalletToken } from '../src/index.js';

const GATEWAY = 'https://mcp.rickydata.org';
const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error('Set PRIVATE_KEY env var (0x-prefixed)');
  process.exit(1);
}

// --- Option 1: Standalone createWalletToken() ---
// Use this when you only need the token string (e.g. for Claude Code config)

const account = privateKeyToAccount(pk as `0x${string}`);
const signFn = (message: string) => account.signMessage({ message });

console.log('=== Option 1: Standalone token creation ===');
const { token, walletAddress, expiresAt } = await createWalletToken(
  GATEWAY,
  signFn,
  account.address,
  '2027-02-13T00:00:00Z',
);
console.log(`Token: ${token.slice(0, 30)}...`);
console.log(`Wallet: ${walletAddress}`);
console.log(`Expires: ${expiresAt}`);
console.log(`\nUse with Claude Code:`);
console.log(`  claude mcp add --transport http \\`);
console.log(`    --header "Authorization:Bearer ${token}" \\`);
console.log(`    mcp-gateway ${GATEWAY}/mcp`);

// --- Option 2: MCPGateway.authenticateWithWalletToken() ---
// Use this when you want the full SDK experience with auto-reauth

console.log('\n=== Option 2: SDK client with wallet token ===');
const gw = new MCPGateway({ url: GATEWAY });
const session = await gw.authenticateWithWalletToken(
  signFn,
  account.address,
  '2027-02-13T00:00:00Z',
);
console.log(`Authenticated: ${session.token.slice(0, 30)}...`);

const servers = await gw.listServers({ limit: 3 });
console.log(`\nServers (first 3):`);
for (const s of servers) {
  console.log(`  ${s.name} — ${s.toolsCount ?? 0} tools`);
}
