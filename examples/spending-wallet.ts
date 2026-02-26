/**
 * Spending Wallet: Call a tool with x402 payment
 *
 * Uses a SpendingWallet with safety limits to auto-sign payments.
 * Makes a real $0.0005 USDC payment on Base mainnet.
 *
 * Run: PRIVATE_KEY=0x... npx tsx examples/spending-wallet.ts
 */
import { MCPGateway, SpendingWallet } from '../src/index.js';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Set PRIVATE_KEY env var');
  process.exit(1);
}

// Create a spending wallet with safety limits
const wallet = await SpendingWallet.fromPrivateKey(PRIVATE_KEY, {
  maxPerCall: 0.01,       // Max $0.01 per call
  maxPerSession: 1.0,     // Max $1.00 per session
  maxPerDay: 5.0,         // Max $5.00 per day
  allowedEndpoints: ['mcp.rickydata.org'],
});

// Monitor events
wallet.on('payment:signed', (receipt) => {
  console.log(`Payment: $${receipt.amountUsd} to ${receipt.to}`);
});
wallet.on('spending:warning', ({ period, percentUsed }) => {
  console.log(`Warning: ${percentUsed.toFixed(0)}% of ${period} budget used`);
});

console.log(`Wallet: ${wallet.address}`);

// Check balance
const balance = await wallet.getBalance();
console.log(`Balance: ${balance.usdc} USDC, ${balance.eth} ETH`);

// Create gateway with wallet
const gw = new MCPGateway({
  url: 'https://mcp.rickydata.org',
  spendingWallet: wallet,
});

// Authenticate and store API key
const normalizedPrivateKey = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(normalizedPrivateKey as `0x${string}`);
await gw.authenticateAuto({
  signFn: (message) => account.signMessage({ message }),
  walletAddress: account.address,
});
const BRAVE_SERVER = '00a36b1c-a28a-439e-940b-165bb8ef1d12';

// Store Brave API key (get yours at https://brave.com/search/api/)
if (process.env.BRAVE_API_KEY) {
  await gw.storeSecrets(BRAVE_SERVER, { BRAVE_API_KEY: process.env.BRAVE_API_KEY });
  console.log('Brave API key stored');
}

// Call Brave Search — auto-signs x402 payment
console.log('\nCalling Brave Search...');
const result = await gw.callTool(BRAVE_SERVER, 'brave_web_search', {
  query: 'MCP model context protocol',
});

console.log(`Result (isError=${result.isError}):`);
console.log(JSON.stringify(result.content, null, 2).slice(0, 500));

// Spending summary
const spending = gw.getSpending();
console.log(`\nSpending: ${spending.callCount} calls, $${spending.sessionSpent.toFixed(4)} total`);
console.log(`Remaining today: $${wallet.getRemainingBudget('day').toFixed(4)}`);

// Clean up
wallet.destroy();
