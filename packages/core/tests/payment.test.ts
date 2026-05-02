import { beforeEach, describe, it, expect, vi } from 'vitest';
import { SpendingTracker } from '../src/payment/spending-tracker.js';
import { signPayment } from '../src/payment/payment-signer.js';
import type { PaymentReceipt, PaymentRequirements } from '../src/types/payment.js';

const signTypedData = vi.fn().mockResolvedValue('0xmocksignature');

vi.mock('viem', () => ({
  createWalletClient: () => ({ signTypedData }),
  http: () => ({}),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
}));

function makeReceipt(amountUsd: number): PaymentReceipt {
  return {
    timestamp: Date.now(),
    amountUsd,
    amountBaseUnits: String(Math.round(amountUsd * 1_000_000)),
    from: '0xabc',
    to: '0xdef',
    nonce: '0x123',
    signature: '0xsig',
    success: true,
  };
}

describe('SpendingTracker (v2)', () => {
  it('starts with zero spending', () => {
    const tracker = new SpendingTracker();
    const summary = tracker.getSummary();
    expect(summary.totalSpent).toBe(0);
    expect(summary.sessionSpent).toBe(0);
    expect(summary.callCount).toBe(0);
  });

  it('records payments correctly', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment(makeReceipt(0.01));
    tracker.recordPayment(makeReceipt(0.02));
    const summary = tracker.getSummary();
    expect(summary.totalSpent).toBeCloseTo(0.03);
    expect(summary.callCount).toBe(2);
  });

  it('provides period breakdowns', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment(makeReceipt(0.01));
    const summary = tracker.getSummary();
    expect(summary.daySpent).toBeCloseTo(0.01);
    expect(summary.weekSpent).toBeCloseTo(0.01);
    expect(summary.sessionSpent).toBeCloseTo(0.01);
  });
});

describe('signPayment hardening', () => {
  const account = { address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}` };
  const baseRequirements: PaymentRequirements = {
    amount: '500',
    recipient: '0x2c241F8509BB6a7b672a440DFebd332cB0B258DE',
    usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    network: 'eip155:8453',
    chainId: 8453,
  };

  beforeEach(() => {
    signTypedData.mockClear();
  });

  it('rejects untrusted chain IDs before signing', async () => {
    await expect(signPayment(account, { ...baseRequirements, chainId: 84532 })).rejects.toThrow('Untrusted chain ID 84532');
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it('rejects untrusted USDC contracts before signing', async () => {
    await expect(signPayment(account, {
      ...baseRequirements,
      usdcContract: '0x0000000000000000000000000000000000000BAD',
    })).rejects.toThrow('Untrusted USDC contract');
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it('signs Base mainnet USDC payments', async () => {
    const result = await signPayment(account, baseRequirements);

    expect(result.header).toBeTruthy();
    expect(signTypedData).toHaveBeenCalledWith(expect.objectContaining({
      domain: expect.objectContaining({
        chainId: 8453n,
        verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      }),
    }));
  });
});
