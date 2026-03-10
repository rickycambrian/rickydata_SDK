export interface PaymentConfig {
  enabled: boolean;
  network: string;
  usdcAddress: string;
  recipientAddress: string;
  pricePerCall: string;
}

export interface PaymentRequirements {
  /** Amount in USDC base units (6 decimals) - e.g. "500" = $0.0005 */
  amount: string;
  recipient: string;
  usdcContract: string;
  network: string;
  chainId: number;
  /** EIP-712 domain name for the token (default: "USD Coin") */
  tokenName?: string;
  /** EIP-712 domain version for the token (default: "2") */
  tokenVersion?: string;
}

/** Receipt for a completed payment */
export interface PaymentReceipt {
  timestamp: number;
  amountUsd: number;
  amountBaseUnits: string;
  from: string;
  to: string;
  nonce: string;
  signature: string;
  endpoint?: string;
  toolName?: string;
  success: boolean;
  error?: string;
}

/** Signed payment result returned by SpendingWallet.signPayment() */
export interface SignedPayment {
  /** Base64-encoded PAYMENT-SIGNATURE header value (x402 v2) */
  header: string;
  /** Payment receipt for audit trail */
  receipt: PaymentReceipt;
}

/** Enhanced spending summary with per-period breakdowns */
export interface SpendingSummary {
  totalSpent: number;
  sessionSpent: number;
  daySpent: number;
  weekSpent: number;
  callCount: number;
}

/** Result of a spending policy validation */
export interface PolicyResult {
  allowed: boolean;
  violation?: PolicyViolationType;
  message?: string;
  dryRun?: boolean;
}

/** Types of policy violations */
export type PolicyViolationType =
  | 'CALL_LIMIT'
  | 'SESSION_LIMIT'
  | 'DAILY_LIMIT'
  | 'WEEKLY_LIMIT'
  | 'ENDPOINT_NOT_ALLOWED'
  | 'DUPLICATE_PAYMENT'
  | 'CIRCUIT_BREAKER'
  | 'APPROVAL_DECLINED'
  | 'DRY_RUN';

export interface AuthSession {
  token: string;
  address: string;
  expiresAt: string;
}
