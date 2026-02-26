import { describe, it, expect } from 'vitest';
import { SpendingTracker } from '../src/payment/spending-tracker.js';
import type { PaymentReceipt } from '../src/types/payment.js';

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
