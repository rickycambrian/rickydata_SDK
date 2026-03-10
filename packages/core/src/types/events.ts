import type { PaymentReceipt } from './payment.js';

/** Typed event map for SpendingWallet */
export interface PaymentEvents {
  'payment:signed': PaymentReceipt;
  'payment:rejected': { reason: string; message: string };
  'balance:low': { balance: number; threshold: number };
  'spending:warning': { period: string; percentUsed: number; spent: number; limit: number };
  'circuit-breaker:tripped': { failureCount: number; threshold: number };
}
