/**
 * Payment Events: Listen to the payment lifecycle
 *
 * SpendingWallet emits typed events at each stage of the payment flow.
 * This example demonstrates the event-driven payment monitoring.
 *
 * Run: PRIVATE_KEY=0x... npx tsx examples/events.ts
 */
import { MCPGateway, SpendingWallet } from '../src/index.js';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Set PRIVATE_KEY env var (0x-prefixed)');
  process.exit(1);
}

// Create wallet with tight limits to trigger warnings
const wallet = await SpendingWallet.fromPrivateKey(PRIVATE_KEY, {
  maxPerCall: 0.01,
  maxPerSession: 0.002,  // Intentionally low to trigger warnings
  maxPerDay: 0.01,
  circuitBreakerThreshold: 3,
});

console.log(`Wallet: ${wallet.address}`);
console.log('Listening for payment events...\n');

// --- Payment Lifecycle Events ---

wallet.on('payment:signing', ({ toolName, amountUsd }) => {
  console.log(`[SIGNING] Preparing to sign payment for ${toolName} ($${amountUsd})`);
});

wallet.on('payment:signed', (receipt) => {
  console.log(`[SIGNED] Payment signature created:`);
  console.log(`  Tool: ${receipt.toolName}`);
  console.log(`  Amount: $${receipt.amountUsd} (${receipt.amountUsdc} USDC)`);
  console.log(`  To: ${receipt.to}`);
  console.log(`  Nonce: ${receipt.nonce}`);
});

wallet.on('payment:settled', (receipt) => {
  console.log(`[SETTLED] Payment confirmed on-chain`);
  console.log(`  Tx: ${receipt.transactionHash ?? 'pending'}`);
});

wallet.on('payment:failed', ({ reason, message }) => {
  console.error(`[FAILED] Payment failed: ${reason}`);
  console.error(`  ${message}`);
});

// --- Policy Enforcement Events ---

wallet.on('payment:rejected', ({ reason, message }) => {
  console.warn(`[REJECTED] Payment blocked by policy: ${reason}`);
  console.warn(`  ${message}`);
});

wallet.on('spending:warning', ({ period, percentUsed, amountSpent, limit }) => {
  console.warn(`[WARNING] ${percentUsed.toFixed(0)}% of ${period} budget used ($${amountSpent.toFixed(4)} / $${limit.toFixed(2)})`);
});

// --- Circuit Breaker Events ---

wallet.on('circuit-breaker:tripped', ({ failureCount, threshold, cooldownMs }) => {
  console.error(`[CIRCUIT BREAKER] Tripped after ${failureCount} failures (threshold: ${threshold})`);
  console.error(`  Payments halted for ${cooldownMs / 1000}s`);
});

wallet.on('circuit-breaker:reset', () => {
  console.log(`[CIRCUIT BREAKER] Reset - payments resumed`);
});

// --- Balance Events ---

wallet.on('balance:low', ({ balance, threshold }) => {
  console.warn(`[LOW BALANCE] ${balance} USDC (threshold: ${threshold})`);
  console.warn(`  Consider topping up your wallet`);
});

// --- Attempt a payment ---

const gw = new MCPGateway({
  url: 'https://mcp.rickydata.org',
  spendingWallet: wallet,
});

const normalizedPrivateKey = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(normalizedPrivateKey as `0x${string}`);
await gw.authenticateAuto({
  signFn: (message) => account.signMessage({ message }),
  walletAddress: account.address,
});

const BRAVE_SERVER = '00a36b1c-a28a-439e-940b-165bb8ef1d12';

try {
  console.log('Calling tool (this will trigger events)...\n');
  await gw.callTool(BRAVE_SERVER, 'brave_web_search', {
    query: 'MCP protocol',
  });
  console.log('\nTool call succeeded');
} catch (err: any) {
  console.error(`\nTool call failed: ${err.message}`);
  if (err.violation) {
    console.error(`Policy violation: ${err.violation}`);
  }
}

// Clean up
wallet.destroy();
