import type { PaymentReceipt, SpendingSummary } from '../types/payment.js';

/**
 * Enhanced spending tracker with full payment history and export/import.
 */
export class SpendingTracker {
  private history: PaymentReceipt[] = [];
  private sessionSpent = 0;
  private callCount = 0;

  /** Record a payment receipt */
  recordPayment(receipt: PaymentReceipt): void {
    this.history.push(receipt);
    this.sessionSpent += receipt.amountUsd;
    this.callCount++;
  }

  /** Get payment history, most recent first */
  getHistory(opts?: { limit?: number }): PaymentReceipt[] {
    const sorted = [...this.history].sort((a, b) => b.timestamp - a.timestamp);
    if (opts?.limit && opts.limit > 0) {
      return sorted.slice(0, opts.limit);
    }
    return sorted;
  }

  /** Get spending summary with per-period breakdowns */
  getSummary(): SpendingSummary {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    let daySpent = 0;
    let weekSpent = 0;
    let totalSpent = 0;

    for (const r of this.history) {
      totalSpent += r.amountUsd;
      if (r.timestamp >= dayAgo) daySpent += r.amountUsd;
      if (r.timestamp >= weekAgo) weekSpent += r.amountUsd;
    }

    return {
      totalSpent,
      sessionSpent: this.sessionSpent,
      daySpent,
      weekSpent,
      callCount: this.callCount,
    };
  }

  /** Export history for persistence */
  exportHistory(): { history: PaymentReceipt[]; exportedAt: string } {
    return {
      history: this.history,
      exportedAt: new Date().toISOString(),
    };
  }

  /** Import previously exported history */
  importHistory(data: { history: PaymentReceipt[] }): void {
    if (!Array.isArray(data.history)) return;
    for (const receipt of data.history) {
      this.history.push(receipt);
      this.sessionSpent += receipt.amountUsd;
      this.callCount++;
    }
  }
}
