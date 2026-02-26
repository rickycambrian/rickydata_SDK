import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SpendingWallet } from '../src/wallet/spending-wallet.js';
import type { PaymentRequirements } from '../src/types/payment.js';

// Mock viem modules to avoid real crypto operations in tests
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: (key: string) => ({
    address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
    signTypedData: vi.fn().mockResolvedValue('0xmocksig'),
  }),
  generatePrivateKey: () => '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
}));

vi.mock('viem', () => ({
  createWalletClient: ({ account }: { account: unknown }) => ({
    signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
  }),
  http: () => ({}),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
}));

const mockRequirements: PaymentRequirements = {
  amount: '500', // $0.0005
  recipient: '0xRecipient',
  usdcContract: '0xUSDC',
  network: 'base',
  chainId: 8453,
};

describe('SpendingWallet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates from private key', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    expect(wallet.address).toMatch(/^0x/);
    expect(wallet.isHD).toBe(false);
  });

  it('generates a new wallet', async () => {
    const wallet = await SpendingWallet.generate();
    expect(wallet.address).toMatch(/^0x/);
    expect(wallet.isHD).toBe(false);
  });

  it('signs a payment and records it', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 1.0,
      maxPerSession: 10,
      maxPerDay: 50,
      maxPerWeek: 200,
    });

    const events: unknown[] = [];
    wallet.on('payment:signed', (receipt) => events.push(receipt));

    const { header, receipt } = await wallet.signPayment(mockRequirements, 'http://gateway.com', 'search');

    expect(header).toBeTruthy();
    expect(receipt.amountUsd).toBeCloseTo(0.0005);
    expect(receipt.success).toBe(true);
    expect(receipt.endpoint).toBe('http://gateway.com');
    expect(receipt.toolName).toBe('search');
    expect(events).toHaveLength(1);
  });

  it('rejects payment when policy denies', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 0.0001, // Lower than $0.0005
    });

    const rejections: unknown[] = [];
    wallet.on('payment:rejected', (data) => rejections.push(data));

    await expect(wallet.signPayment(mockRequirements)).rejects.toThrow('per-call limit');
    expect(rejections).toHaveLength(1);
  });

  it('tracks spending via getSpending()', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
    });

    await wallet.signPayment(mockRequirements);
    const spending = wallet.getSpending();
    expect(spending.callCount).toBe(1);
    expect(spending.sessionSpent).toBeCloseTo(0.0005);
  });

  it('returns payment history', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      deduplicationWindowSeconds: 0, // Disable dedup for this test
    });

    await wallet.signPayment(mockRequirements, 'http://gw.com', 'tool1');
    await wallet.signPayment(mockRequirements, 'http://gw2.com', 'tool2');

    const history = wallet.getHistory();
    expect(history).toHaveLength(2);
  });

  it('emits circuit-breaker:tripped after failures', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 1, circuitBreakerThreshold: 2,
    });

    const tripped: unknown[] = [];
    wallet.on('circuit-breaker:tripped', (data) => tripped.push(data));

    wallet.recordFailure();
    expect(tripped).toHaveLength(0);
    wallet.recordFailure();
    expect(tripped).toHaveLength(1);
  });

  it('exports and returns remaining budget', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 1, maxPerSession: 1.0, maxPerDay: 5.0, maxPerWeek: 20.0,
    });

    await wallet.signPayment(mockRequirements);
    expect(wallet.getRemainingBudget('session')).toBeCloseTo(0.9995);
    expect(wallet.getRemainingBudget('day')).toBeCloseTo(4.9995);
  });

  it('destroy() clears account and prevents signing', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
    wallet.destroy();
    await expect(wallet.signPayment(mockRequirements)).rejects.toThrow('destroyed');
  });

  it('dry run mode does not sign', async () => {
    const wallet = await SpendingWallet.fromPrivateKey('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', {
      maxPerCall: 1, dryRun: true,
    });

    const { header, receipt } = await wallet.signPayment(mockRequirements);
    expect(header).toBe('');
    expect(receipt.signature).toBe('0x0');
  });
});
