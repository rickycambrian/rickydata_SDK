/**
 * HD Wallet: Production agent with seed phrase derivation
 *
 * Uses BIP-44 HD derivation (m/44'/60'/8453'/0/{index}) for
 * recoverable, isolated spending wallets.
 *
 * Run: SEED_PHRASE="word1 word2 ..." npx tsx examples/hd-wallet.ts
 */
import { SpendingWallet } from '../src/index.js';

const SEED = process.env.SEED_PHRASE;
if (!SEED) {
  console.error('Set SEED_PHRASE env var (12+ word BIP-39 mnemonic)');
  process.exit(1);
}

// Derive multiple wallets from the same seed
const wallet0 = await SpendingWallet.fromSeedPhrase(SEED, 0, {
  maxPerDay: 10.0,
  circuitBreakerThreshold: 5,
});

const wallet1 = await SpendingWallet.fromSeedPhrase(SEED, 1, {
  maxPerDay: 10.0,
});

console.log(`Wallet 0 (HD): ${wallet0.address} isHD=${wallet0.isHD}`);
console.log(`Wallet 1 (HD): ${wallet1.address} isHD=${wallet1.isHD}`);
console.log(`Addresses are different: ${wallet0.address !== wallet1.address}`);

// Check balances
const b0 = await wallet0.getBalance();
const b1 = await wallet1.getBalance();
console.log(`\nWallet 0: ${b0.usdc} USDC`);
console.log(`Wallet 1: ${b1.usdc} USDC`);

// Deterministic — same seed + index always gives same address
const wallet0b = await SpendingWallet.fromSeedPhrase(SEED, 0);
console.log(`\nDeterministic: ${wallet0.address === wallet0b.address}`);

wallet0.destroy();
wallet1.destroy();
wallet0b.destroy();
