import { describe, it, expect } from 'vitest';
import { SpendingTracker } from '../src/payment/spending-tracker.js';
import type { PaymentReceipt } from '../src/types/payment.js';

function makeReceipt(overrides: Partial<PaymentReceipt> = {}): PaymentReceipt {
  return {
    timestamp: Date.now(),
    amountUsd: 0.0005,
    amountBaseUnits: '500',
    from: '0xabc',
    to: '0xdef',
    nonce: '0x123',
    signature: '0xsig',
    success: true,
    ...overrides,
  };
}

describe('SpendingTracker', () => {
  it('starts with zero spending', () => {
    const tracker = new SpendingTracker();
    const summary = tracker.getSummary();
    expect(summary.totalSpent).toBe(0);
    expect(summary.sessionSpent).toBe(0);
    expect(summary.callCount).toBe(0);
  });

  it('records payments correctly', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment(makeReceipt({ amountUsd: 0.01 }));
    tracker.recordPayment(makeReceipt({ amountUsd: 0.02 }));

    const summary = tracker.getSummary();
    expect(summary.totalSpent).toBeCloseTo(0.03);
    expect(summary.sessionSpent).toBeCloseTo(0.03);
    expect(summary.callCount).toBe(2);
  });

  it('returns history most recent first', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment(makeReceipt({ timestamp: 1000, amountUsd: 0.01 }));
    tracker.recordPayment(makeReceipt({ timestamp: 2000, amountUsd: 0.02 }));
    tracker.recordPayment(makeReceipt({ timestamp: 3000, amountUsd: 0.03 }));

    const history = tracker.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].timestamp).toBe(3000);
    expect(history[2].timestamp).toBe(1000);
  });

  it('limits history results', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment(makeReceipt({ timestamp: 1000 }));
    tracker.recordPayment(makeReceipt({ timestamp: 2000 }));
    tracker.recordPayment(makeReceipt({ timestamp: 3000 }));

    const history = tracker.getHistory({ limit: 2 });
    expect(history).toHaveLength(2);
    expect(history[0].timestamp).toBe(3000);
  });

  it('exports and imports history', () => {
    const tracker = new SpendingTracker();
    tracker.recordPayment(makeReceipt({ amountUsd: 0.01 }));
    tracker.recordPayment(makeReceipt({ amountUsd: 0.02 }));

    const exported = tracker.exportHistory();
    expect(exported.history).toHaveLength(2);
    expect(exported.exportedAt).toBeDefined();

    const tracker2 = new SpendingTracker();
    tracker2.importHistory(exported);
    const summary = tracker2.getSummary();
    expect(summary.totalSpent).toBeCloseTo(0.03);
    expect(summary.callCount).toBe(2);
  });

  it('handles day/week period breakdowns', () => {
    const tracker = new SpendingTracker();
    // Payment from now
    tracker.recordPayment(makeReceipt({ timestamp: Date.now(), amountUsd: 0.01 }));
    // Payment from 2 days ago (within week, outside day)
    tracker.recordPayment(makeReceipt({ timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000, amountUsd: 0.02 }));

    const summary = tracker.getSummary();
    expect(summary.daySpent).toBeCloseTo(0.01);
    expect(summary.weekSpent).toBeCloseTo(0.03);
    expect(summary.totalSpent).toBeCloseTo(0.03);
  });
});
