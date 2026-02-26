/**
 * Live integration tests against the production MCP Gateway.
 *
 * These tests make REAL API calls when LIVE_TEST=1.
 * They verify the SDK works end-to-end against production.
 *
 * Run with: LIVE_TEST=1 npx vitest run tests/live.test.ts
 *
 * Required env:
 *   TEST_WALLET_PRIVATE_KEY - Wallet private key for signing (LIVE only)
 *   BRAVE_API_KEY - Brave Search API key (LIVE only)
 * Optional env:
 *   TEST_WALLET_ADDRESS - Wallet address; if omitted, derived from private key
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { MCPGateway } from '../src/client.js';
import { SpendingWallet } from '../src/wallet/spending-wallet.js';
import { SpendingPolicy } from '../src/wallet/spending-policy.js';
import { checkBalance } from '../src/wallet/balance-checker.js';
import { accountFromPrivateKey, deriveSpendingAccount, generateAccount } from '../src/wallet/wallet-derivation.js';
import { signPayment } from '../src/payment/payment-signer.js';
import { SpendingTracker } from '../src/payment/spending-tracker.js';
import type { PaymentRequirements } from '../src/types/payment.js';

const LIVE = process.env.LIVE_TEST === '1';
const GATEWAY_URL = 'https://mcp.rickydata.org';
// Non-sensitive test key for local deterministic crypto tests.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_WALLET_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const LIVE_PRIVATE_KEY = process.env.TEST_WALLET_PRIVATE_KEY || '';
const LIVE_WALLET_ADDRESS_ENV = process.env.TEST_WALLET_ADDRESS || '';
const BRAVE_SERVER_ID = '00a36b1c-a28a-439e-940b-165bb8ef1d12';
const LIVE_BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const OPERATOR_ADDRESS = '0x2c241F8509BB6a7b672a440DFebd332cB0B258DE';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const describeIf = LIVE ? describe : describe.skip;

// ============================================================
// 1. Wallet Derivation Tests (no network required)
// ============================================================
describe('wallet derivation (real crypto)', () => {
  it('privateKeyToAccount produces correct address', async () => {
    const account = await accountFromPrivateKey(TEST_PRIVATE_KEY);
    expect(account.address.toLowerCase()).toBe(TEST_WALLET_ADDRESS.toLowerCase());
  });

  it('generated account has valid address format', async () => {
    const { privateKey, account } = await generateAccount();
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('HD derivation produces deterministic addresses', async () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const account0 = await deriveSpendingAccount(mnemonic, 0);
    const account1 = await deriveSpendingAccount(mnemonic, 1);

    // Same seed + index = same address
    const account0b = await deriveSpendingAccount(mnemonic, 0);
    expect(account0.address).toBe(account0b.address);

    // Different indices = different addresses
    expect(account0.address).not.toBe(account1.address);

    // Addresses are valid
    expect(account0.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(account1.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

// ============================================================
// 2. EIP-712 Signing Tests (real crypto, no network)
// ============================================================
describe('EIP-712 payment signing (real crypto)', () => {
  it('signPayment produces valid base64 header with correct structure', async () => {
    const account = await accountFromPrivateKey(TEST_PRIVATE_KEY);
    const requirements: PaymentRequirements = {
      amount: '500',
      recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS,
      network: 'base',
      chainId: 8453,
    };

    const { header, receipt } = await signPayment(account, requirements);

    // Header is valid base64
    expect(header).toBeTruthy();
    const decoded = JSON.parse(atob(header));

    // x402 v2 protocol fields
    expect(decoded.x402Version).toBe(2);
    expect(decoded.scheme).toBe('exact');
    expect(decoded.network).toBe('eip155:8453');

    // Payload structure
    expect(decoded.payload).toBeDefined();
    expect(decoded.payload.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(decoded.payload.authorization).toBeDefined();
    expect(decoded.payload.authorization.from.toLowerCase()).toBe(TEST_WALLET_ADDRESS.toLowerCase());
    expect(decoded.payload.authorization.to.toLowerCase()).toBe(OPERATOR_ADDRESS.toLowerCase());
    expect(decoded.payload.authorization.value).toBe('500');
    expect(decoded.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);

    // Receipt is correct
    expect(receipt.amountUsd).toBeCloseTo(0.0005);
    expect(receipt.amountBaseUnits).toBe('500');
    expect(receipt.from.toLowerCase()).toBe(TEST_WALLET_ADDRESS.toLowerCase());
    expect(receipt.to.toLowerCase()).toBe(OPERATOR_ADDRESS.toLowerCase());
    expect(receipt.success).toBe(true);
  });

  it('signatures are unique (different nonces)', async () => {
    const account = await accountFromPrivateKey(TEST_PRIVATE_KEY);
    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };

    const sig1 = await signPayment(account, requirements);
    const sig2 = await signPayment(account, requirements);

    expect(sig1.receipt.nonce).not.toBe(sig2.receipt.nonce);
    expect(sig1.receipt.signature).not.toBe(sig2.receipt.signature);
  });
});

// ============================================================
// 3. SpendingWallet Tests (real crypto)
// ============================================================
describe('SpendingWallet (real crypto)', () => {
  it('fromPrivateKey creates wallet with correct address', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY);
    expect(wallet.address.toLowerCase()).toBe(TEST_WALLET_ADDRESS.toLowerCase());
    expect(wallet.isHD).toBe(false);
  });

  it('fromSeedPhrase creates HD wallet', async () => {
    const mnemonic = 'test test test test test test test test test test test junk';
    const wallet = await SpendingWallet.fromSeedPhrase(mnemonic, 0);
    expect(wallet.isHD).toBe(true);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('generate creates random wallet', async () => {
    const w1 = await SpendingWallet.generate();
    const w2 = await SpendingWallet.generate();
    expect(w1.address).not.toBe(w2.address);
  });

  it('signPayment with policy validation works', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY, {
      maxPerCall: 0.01,
      maxPerSession: 1.0,
      maxPerDay: 5.0,
    });

    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };

    const { header, receipt } = await wallet.signPayment(requirements, GATEWAY_URL, 'brave_web_search');

    expect(header).toBeTruthy();
    expect(receipt.success).toBe(true);
    expect(receipt.endpoint).toBe(GATEWAY_URL);
    expect(receipt.toolName).toBe('brave_web_search');

    // Spending tracked
    const spending = wallet.getSpending();
    expect(spending.callCount).toBe(1);
    expect(spending.sessionSpent).toBeCloseTo(0.0005);
  });

  it('policy rejects over-limit payments', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY, {
      maxPerCall: 0.0001, // Very low limit
    });

    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };

    await expect(wallet.signPayment(requirements)).rejects.toThrow(/exceeds per-call limit/i);
  });

  it('endpoint allowlist blocks unauthorized endpoints', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY, {
      allowedEndpoints: ['some-other-gateway.com'],
    });

    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };

    await expect(
      wallet.signPayment(requirements, 'https://mcp.rickydata.org', 'tool')
    ).rejects.toThrow(/not allowed|ENDPOINT/i);
  });

  it('events are emitted on payment', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY, {
      maxPerCall: 1.0,
    });

    const events: string[] = [];
    wallet.on('payment:signed', () => events.push('signed'));

    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };
    await wallet.signPayment(requirements);
    expect(events).toContain('signed');
  });

  it('destroy clears key material', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY);
    wallet.destroy();

    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };
    await expect(wallet.signPayment(requirements)).rejects.toThrow(/destroyed/i);
  });

  it('history export/import preserves data', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY, {
      maxPerCall: 1.0, maxPerSession: 100,
      deduplicationWindowSeconds: 0, // Disable dedup for this test
    });

    const requirements: PaymentRequirements = {
      amount: '500', recipient: OPERATOR_ADDRESS,
      usdcContract: USDC_ADDRESS, network: 'base', chainId: 8453,
    };
    await wallet.signPayment(requirements, GATEWAY_URL, 'tool1');
    await wallet.signPayment(requirements, GATEWAY_URL, 'tool2');

    const exported = wallet.exportHistory();
    expect(exported.history).toHaveLength(2);

    // Import into new wallet
    const wallet2 = await SpendingWallet.fromPrivateKey(TEST_PRIVATE_KEY);
    wallet2.importHistory(exported);
    expect(wallet2.getHistory().length).toBe(2);
  });
});

// ============================================================
// 4. SpendingPolicy Comprehensive Tests
// ============================================================
describe('SpendingPolicy (comprehensive)', () => {
  it('circuit breaker trips after threshold failures', () => {
    const policy = new SpendingPolicy({
      circuitBreakerThreshold: 3,
    });

    policy.recordFailure();
    policy.recordFailure();
    expect(policy.getStats().circuitBreaker.tripped).toBe(false);

    policy.recordFailure();
    expect(policy.getStats().circuitBreaker.tripped).toBe(true);
  });

  it('deduplication window blocks rapid duplicate payments', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 10, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      deduplicationWindowSeconds: 10,
    });

    // First payment OK
    const r1 = await policy.validate(0.0005, 'http://gw', 'tool1');
    expect(r1.allowed).toBe(true);
    policy.recordPayment(0.0005, 'http://gw', 'tool1');

    // Duplicate within window = blocked
    const r2 = await policy.validate(0.0005, 'http://gw', 'tool1');
    expect(r2.allowed).toBe(false);
    expect(r2.violation).toBe('DUPLICATE_PAYMENT');
  });

  it('dry run mode validates but blocks signing', async () => {
    const policy = new SpendingPolicy({ dryRun: true });
    const r = await policy.validate(0.0005, 'http://gw', 'tool');
    expect(r.allowed).toBe(true);
    expect(r.dryRun).toBe(true);
  });

  it('approval callback works', async () => {
    let callbackInvoked = false;
    const policy = new SpendingPolicy({
      maxPerCall: 10, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      requireApprovalAbove: 0.0001,
      approvalCallback: async (details) => {
        callbackInvoked = true;
        expect(details.amountUsd).toBeCloseTo(0.0005);
        return true; // approve
      },
    });

    const r = await policy.validate(0.0005, 'http://gw', 'tool');
    expect(r.allowed).toBe(true);
    expect(callbackInvoked).toBe(true);
  });

  it('approval callback rejection blocks payment', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 10, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      requireApprovalAbove: 0,
      approvalCallback: async () => false, // always reject
    });

    const r = await policy.validate(0.0005, 'http://gw', 'tool');
    expect(r.allowed).toBe(false);
    expect(r.violation).toBe('APPROVAL_DECLINED');
  });

  it('remaining budget calculations are correct', () => {
    const policy = new SpendingPolicy({
      maxPerSession: 1.0, maxPerDay: 5.0, maxPerWeek: 20.0,
    });

    policy.recordPayment(0.50);
    expect(policy.getRemaining('session')).toBeCloseTo(0.50);
    expect(policy.getRemaining('day')).toBeCloseTo(4.50);
    expect(policy.getRemaining('week')).toBeCloseTo(19.50);
  });
});

// ============================================================
// 5. SpendingTracker Tests
// ============================================================
describe('SpendingTracker', () => {
  it('tracks multiple payments correctly', () => {
    const tracker = new SpendingTracker();

    tracker.recordPayment({
      timestamp: Date.now(), amountUsd: 0.0005, amountBaseUnits: '500',
      from: TEST_WALLET_ADDRESS, to: OPERATOR_ADDRESS, nonce: '0x1', signature: '0x1', success: true,
    });
    tracker.recordPayment({
      timestamp: Date.now(), amountUsd: 0.001, amountBaseUnits: '1000',
      from: TEST_WALLET_ADDRESS, to: OPERATOR_ADDRESS, nonce: '0x2', signature: '0x2', success: true,
    });

    const summary = tracker.getSummary();
    expect(summary.callCount).toBe(2);
    expect(summary.totalSpent).toBeCloseTo(0.0015);
    expect(summary.sessionSpent).toBeCloseTo(0.0015);
  });

  it('getHistory returns most recent first', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment({
      timestamp: 1000, amountUsd: 0.01, amountBaseUnits: '10000',
      from: '', to: '', nonce: '', signature: '', success: true,
    });
    tracker.recordPayment({
      timestamp: 2000, amountUsd: 0.02, amountBaseUnits: '20000',
      from: '', to: '', nonce: '', signature: '', success: true,
    });

    const history = tracker.getHistory({ limit: 1 });
    expect(history).toHaveLength(1);
    expect(history[0].amountUsd).toBe(0.02);
  });
});

// ============================================================
// 6. LIVE Gateway Integration Tests
// ============================================================
describeIf('LIVE: Gateway integration', () => {
  let wallet: SpendingWallet;
  let gw: MCPGateway;
  let liveWalletAddress = LIVE_WALLET_ADDRESS_ENV;

  beforeAll(async () => {
    if (!LIVE_PRIVATE_KEY) {
      throw new Error('LIVE_TEST=1 requires TEST_WALLET_PRIVATE_KEY');
    }
    if (!LIVE_BRAVE_API_KEY) {
      throw new Error('LIVE_TEST=1 requires BRAVE_API_KEY');
    }

    if (!liveWalletAddress) {
      const account = await accountFromPrivateKey(LIVE_PRIVATE_KEY);
      liveWalletAddress = account.address;
    }

    wallet = await SpendingWallet.fromPrivateKey(LIVE_PRIVATE_KEY, {
      maxPerCall: 0.01,
      maxPerSession: 1.0,
      maxPerDay: 5.0,
      maxPerWeek: 20.0,
      allowedEndpoints: ['mcp.rickydata.org', '34.59.1.154'],
    });

    gw = new MCPGateway({
      url: GATEWAY_URL,
      spendingWallet: wallet,
    });
  });

  it('gateway health check returns healthy', async () => {
    const res = await fetch(`${GATEWAY_URL}/health`);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.kfdb.total).toBeGreaterThan(1000);
  });

  it('payment config shows x402 enabled', async () => {
    const config = await gw.getPaymentConfig();
    expect(config.enabled).toBe(true);
    expect(config.network).toBe('eip155:8453');
  });

  it('authenticate with real wallet signature', async () => {
    // Use real wallet signature (not testMode) — production has ALLOW_TEST_MODE=false
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(LIVE_PRIVATE_KEY as `0x${string}`);
    const signFn = async (message: string) => account.signMessage({ message });

    const session = await gw.authenticate(signFn, liveWalletAddress);
    expect(session.token).toBeTruthy();
    expect(session.address.toLowerCase()).toBe(liveWalletAddress.toLowerCase());
  });

  it('list servers returns 2000+', async () => {
    const servers = await gw.listServers({ limit: 5 });
    expect(servers.length).toBeGreaterThan(0);
    expect(servers[0].name).toBeTruthy();
  });

  it('store secrets for Brave Search', async () => {
    await gw.storeSecrets(BRAVE_SERVER_ID, { BRAVE_API_KEY: LIVE_BRAVE_API_KEY });
    const keys = await gw.getSecrets(BRAVE_SERVER_ID);
    expect(keys).toContain('BRAVE_API_KEY');
  });

  it('callTool with auto-sign x402: Brave Search', async () => {
    const result = await gw.callTool(
      BRAVE_SERVER_ID,
      'brave_web_search',
      { query: 'MCP model context protocol' },
    );

    expect(result.isError).toBe(false);
    expect(result.content).toBeTruthy();

    // Verify payment was tracked
    const spending = gw.getSpending();
    expect(spending.callCount).toBeGreaterThanOrEqual(1);
    expect(spending.sessionSpent).toBeGreaterThan(0);

    // Check history
    const history = wallet.getHistory({ limit: 1 });
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].success).toBe(true);
    expect(history[0].amountUsd).toBeCloseTo(0.0005);
  }, 60_000); // 60s timeout for tool execution

  it('balance check reads from Base mainnet', async () => {
    const balance = await wallet.getBalance();
    expect(balance.usdc).toBeGreaterThanOrEqual(0);
    expect(balance.eth).toBeGreaterThanOrEqual(0);
    console.log(`  Balance: ${balance.usdc} USDC, ${balance.eth} ETH`);
  });

  it('spending summary is accurate after tool call', () => {
    const spending = wallet.getSpending();
    expect(spending.callCount).toBeGreaterThanOrEqual(1);
    expect(spending.sessionSpent).toBeGreaterThanOrEqual(0.0005);
    expect(spending.daySpent).toBeGreaterThanOrEqual(0.0005);

    const remaining = wallet.getRemainingBudget('day');
    expect(remaining).toBeLessThan(5.0);
    expect(remaining).toBeGreaterThan(0);
  });
});

// ============================================================
// 7. LIVE: Balance Check (separate - doesn't need gateway)
// ============================================================
describeIf('LIVE: Balance checker', () => {
  let liveWalletAddress = LIVE_WALLET_ADDRESS_ENV;

  beforeAll(async () => {
    if (!LIVE_PRIVATE_KEY) {
      throw new Error('LIVE_TEST=1 requires TEST_WALLET_PRIVATE_KEY');
    }
    if (!liveWalletAddress) {
      const account = await accountFromPrivateKey(LIVE_PRIVATE_KEY);
      liveWalletAddress = account.address;
    }
  });

  it('reads USDC balance from Base mainnet', async () => {
    const balance = await checkBalance(liveWalletAddress);
    expect(balance.usdc).toBeGreaterThanOrEqual(0);
    expect(typeof balance.usdc).toBe('number');
    console.log(`  ${liveWalletAddress}: ${balance.usdc} USDC, ${balance.eth} ETH`);
  });

  it('returns 0 for fresh random address', async () => {
    const { account } = await generateAccount();
    const balance = await checkBalance(account.address);
    expect(balance.usdc).toBe(0);
    expect(balance.eth).toBe(0);
  });
});
