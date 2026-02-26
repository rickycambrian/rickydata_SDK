import type { SpendingWallet } from '../wallet/spending-wallet.js';

/** Main SDK configuration */
export interface GatewayConfig {
  /** Gateway base URL (e.g. 'http://34.59.1.154:8080') */
  url: string;

  /** New: dedicated spending wallet for x402 payments */
  spendingWallet?: SpendingWallet;

  /** Legacy: raw private key (auto-creates SpendingWallet internally) */
  wallet?: { privateKey: string };

  /** Auth configuration */
  auth?: { token?: string };

  /** Legacy payment limits (used when wallet.privateKey is provided) */
  payment?: {
    autoSign?: boolean;
    maxPerCall?: string;
    maxDaily?: string;
  };
}

/** Configuration for creating a SpendingWallet */
export interface SpendingWalletConfig {
  /** Spending policy limits and rules */
  policy?: SpendingPolicyConfig;
}

/** Spending policy configuration */
export interface SpendingPolicyConfig {
  /** Maximum USD per individual call (default: 0.01) */
  maxPerCall?: number;

  /** Maximum USD per SDK instance lifetime (default: 1.0) */
  maxPerSession?: number;

  /** Maximum USD in rolling 24h window (default: 5.0) */
  maxPerDay?: number;

  /** Maximum USD in rolling 7d window (default: 20.0) */
  maxPerWeek?: number;

  /** Only pay these gateway hostnames/IPs (substring match). Empty = allow all. */
  allowedEndpoints?: string[];

  /** Trip circuit breaker after this many consecutive failures (default: 5) */
  circuitBreakerThreshold?: number;

  /** Seconds to wait before allowing payments after circuit breaker trips (default: 300) */
  circuitBreakerCooldownSeconds?: number;

  /** Reject duplicate payments to same endpoint+amount within this window (default: 30s) */
  deduplicationWindowSeconds?: number;

  /** Call approvalCallback for amounts above this USD value (default: Infinity = never) */
  requireApprovalAbove?: number;

  /** Async callback for human-in-the-loop approval. Return true to approve. */
  approvalCallback?: (details: ApprovalDetails) => Promise<boolean>;

  /** Validate everything without actually signing (default: false) */
  dryRun?: boolean;
}

/** Details passed to the approval callback */
export interface ApprovalDetails {
  amountUsd: number;
  endpoint: string;
  toolName?: string;
  dailySpending: number;
  weeklySpending: number;
  sessionSpending: number;
}
