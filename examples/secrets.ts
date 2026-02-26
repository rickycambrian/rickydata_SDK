/**
 * Secrets Management: Store, get, and delete API keys
 *
 * Shows how to manage server-specific secrets (API keys, tokens, etc.)
 * using the encrypted secrets vault.
 *
 * Run: npx tsx examples/secrets.ts
 */
import { MCPGateway } from '../src/index.js';
import { privateKeyToAccount } from 'viem/accounts';

const gw = new MCPGateway({ url: 'https://mcp.rickydata.org' });

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  throw new Error('Set PRIVATE_KEY to run this example.');
}
const account = privateKeyToAccount(privateKey as `0x${string}`);

console.log('Authenticating with wallet-token...');
const session = await gw.authenticateAuto({
  signFn: (message) => account.signMessage({ message }),
  walletAddress: account.address,
});
if (!session) {
  throw new Error('Expected wallet-token session for this example.');
}
console.log(`Authenticated: ${session.address.slice(0, 10)}...`);

// Example server ID (Brave Search)
const BRAVE_SERVER = '00a36b1c-a28a-439e-940b-165bb8ef1d12';

// Store API keys for a server
console.log('\nStoring secrets...');
await gw.storeSecrets(BRAVE_SERVER, {
  BRAVE_API_KEY: 'BSA1234567890abcdef',
  BRAVE_SEARCH_ENDPOINT: 'https://api.search.brave.com/res/v1/web/search',
});
console.log('Secrets stored successfully');

// List configured secret names
console.log('\nGetting configured secrets...');
const secretNames = await gw.getSecrets(BRAVE_SERVER);
console.log(`Configured secrets: ${secretNames.join(', ')}`);

// Secrets are encrypted and scoped to your wallet.
console.log('\nNote: Secrets are:');
console.log('  - Encrypted with AES-256-GCM');
console.log('  - Scoped to your wallet address');

// Delete secrets when done
console.log('\nDeleting secrets...');
await gw.deleteSecrets(BRAVE_SERVER);
console.log('Secrets deleted successfully');

// Verify deletion
const remaining = await gw.getSecrets(BRAVE_SERVER);
console.log(`Remaining secrets: ${remaining.length === 0 ? 'none' : remaining.join(', ')}`);
