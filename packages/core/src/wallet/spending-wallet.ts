import type { SpendingPolicyConfig } from '../types/config.js';
import type { PaymentRequirements, PaymentReceipt, SignedPayment, SpendingSummary } from '../types/payment.js';
import type { ServerReceipt } from '../types/offer-receipt.js';
import type { PaymentEvents } from '../types/events.js';
import type { WalletBalance } from './balance-checker.js';
import { TypedEventEmitter } from '../events/event-emitter.js';
import { SpendingPolicy } from './spending-policy.js';
import { SpendingTracker } from '../payment/spending-tracker.js';
import { signPayment } from '../payment/payment-signer.js';
import { checkBalance } from './balance-checker.js';
import { deriveSpendingAccount, accountFromPrivateKey, generateAccount } from './wallet-derivation.js';
import { SpendingPolicyError } from '../errors/index.js';
import { USDC_DECIMALS } from '../constants.js';

/**
 * Isolated spending wallet for MCP Gateway x402 payments.
 *
 * Provides defense-in-depth safety: separate key, spending limits,
 * endpoint allowlists, circuit breakers, deduplication, and approval callbacks.
 */
export class SpendingWallet extends TypedEventEmitter<PaymentEvents> {
  private account: { address: `0x${string}` } | null;
  private _destroyed = false;
  private policy: SpendingPolicy;
  private tracker: SpendingTracker;
  private readonly _isHD: boolean;
  private readonly _address: string;
  private _balanceLowThreshold: number;

  private constructor(
    account: { address: `0x${string}` },
    policy: SpendingPolicy,
    isHD: boolean,
    balanceLowThreshold: number = 1.0,
  ) {
    super();
    this.account = account;
    this.policy = policy;
    this.tracker = new SpendingTracker();
    this._isHD = isHD;
    this._address = account.address;
    this._balanceLowThreshold = balanceLowThreshold;
  }

  // --- Factory methods ---

  /**
   * Create a spending wallet from a BIP-39 seed phrase.
   * Uses HD path: m/44'/60'/8453'/0/{index}
   */
  static async fromSeedPhrase(
    seedPhrase: string,
    index: number = 0,
    policyConfig?: SpendingPolicyConfig,
    balanceLowThreshold?: number,
  ): Promise<SpendingWallet> {
    const account = await deriveSpendingAccount(seedPhrase, index);
    return new SpendingWallet(account, new SpendingPolicy(policyConfig), true, balanceLowThreshold);
  }

  /**
   * Create a spending wallet from a raw private key.
   */
  static async fromPrivateKey(
    privateKey: string,
    policyConfig?: SpendingPolicyConfig,
    balanceLowThreshold?: number,
  ): Promise<SpendingWallet> {
    const account = await accountFromPrivateKey(privateKey);
    return new SpendingWallet(account, new SpendingPolicy(policyConfig), false, balanceLowThreshold);
  }

  /**
   * Generate a new random spending wallet (for dev/testing only).
   */
  static async generate(policyConfig?: SpendingPolicyConfig): Promise<SpendingWallet> {
    const { account } = await generateAccount();
    return new SpendingWallet(account, new SpendingPolicy(policyConfig), false);
  }

  // --- Properties ---

  /** Wallet address (safe to log) */
  get address(): string {
    return this._address;
  }

  /** Whether this wallet was derived from a seed phrase */
  get isHD(): boolean {
    return this._isHD;
  }

  // --- Core operation ---

  /**
   * Sign a payment after validating against spending policy.
   * Called internally by ToolsManager when a 402 response is received.
   *
   * @param requirements - Payment requirements from the 402 response
   * @param endpoint - Gateway endpoint URL (for allowlist check)
   * @param toolName - Tool name (for audit trail)
   * @returns Signed payment header and receipt
   * @throws SpendingPolicyError if policy rejects the payment
   */
  async signPayment(
    requirements: PaymentRequirements,
    endpoint?: string,
    toolName?: string,
  ): Promise<SignedPayment> {
    if (this._destroyed || !this.account) {
      throw new SpendingPolicyError('CALL_LIMIT', 'Wallet has been destroyed');
    }

    // Convert base units to USD for policy validation
    const amountUsd = Number(BigInt(requirements.amount)) / (10 ** USDC_DECIMALS);

    // Validate against policy
    const result = await this.policy.validate(amountUsd, endpoint, toolName);

    if (!result.allowed) {
      this.emit('payment:rejected', {
        reason: result.violation ?? 'UNKNOWN',
        message: result.message ?? 'Payment rejected by spending policy',
      });
      throw new SpendingPolicyError(
        result.violation ?? 'CALL_LIMIT',
        result.message ?? 'Payment rejected by spending policy',
      );
    }

    if (result.dryRun) {
      // In dry run mode, return a mock receipt
      const mockReceipt: PaymentReceipt = {
        timestamp: Date.now(),
        amountUsd,
        amountBaseUnits: requirements.amount,
        from: this._address,
        to: requirements.recipient,
        nonce: '0x0',
        signature: '0x0',
        endpoint,
        toolName,
        success: true,
      };
      return { header: '', receipt: mockReceipt };
    }

    // Sign the payment
    const { header, receipt } = await signPayment(this.account, requirements);

    // Enrich receipt with context
    receipt.endpoint = endpoint;
    receipt.toolName = toolName;

    // Record in policy and tracker
    this.policy.recordPayment(amountUsd, endpoint, toolName);
    this.tracker.recordPayment(receipt);

    // Emit event
    this.emit('payment:signed', receipt);

    // Check spending warnings
    this.checkSpendingWarnings();

    return { header, receipt };
  }

  /** Record a payment failure (for circuit breaker tracking) */
  recordFailure(): void {
    this.policy.recordFailure();
    const stats = this.policy.getStats();
    if (stats.circuitBreaker.tripped) {
      this.emit('circuit-breaker:tripped', {
        failureCount: stats.circuitBreaker.failureCount,
        threshold: stats.circuitBreaker.threshold,
      });
    }
  }

  // --- Monitoring ---

  /**
   * Check USDC and ETH balances.
   * Emits `balance:low` if USDC balance is below the configured threshold (default 1.0 USDC).
   */
  async getBalance(rpcUrl?: string): Promise<WalletBalance> {
    const balance = await checkBalance(this._address, rpcUrl);
    this.checkBalanceThreshold(balance.usdc);
    return balance;
  }

  /**
   * Check USDC balance against the configured low-balance threshold and emit
   * `balance:low` if it is below the threshold.
   *
   * @param usdcBalance - Current USDC balance in human-readable units
   */
  checkBalanceThreshold(usdcBalance: number): void {
    if (usdcBalance < this._balanceLowThreshold) {
      this.emit('balance:low', { balance: usdcBalance, threshold: this._balanceLowThreshold });
    }
  }

  /** Set the USDC balance threshold below which `balance:low` is emitted (default 1.0) */
  setBalanceLowThreshold(threshold: number): void {
    this._balanceLowThreshold = threshold;
  }

  /** Get spending summary */
  getSpending(): SpendingSummary {
    return this.tracker.getSummary();
  }

  /** Get payment history */
  getHistory(opts?: { limit?: number }): PaymentReceipt[] {
    return this.tracker.getHistory(opts);
  }

  /** Get remaining budget for a period */
  getRemainingBudget(period: 'day' | 'week' | 'session'): number {
    return this.policy.getRemaining(period);
  }

  /** Export history for persistence */
  exportHistory() {
    return this.tracker.exportHistory();
  }

  /** Import previously exported history */
  importHistory(data: { history: PaymentReceipt[] }): void {
    this.tracker.importHistory(data);
  }

  /** Record a server-signed receipt */
  recordServerReceipt(receipt: ServerReceipt): void {
    this.tracker.recordServerReceipt(receipt);
  }

  /** Get server receipts, most recent first */
  getServerReceipts(opts?: { limit?: number }): ServerReceipt[] {
    return this.tracker.getServerReceipts(opts);
  }

  /** Export server receipts for persistence */
  exportServerReceipts() {
    return this.tracker.exportServerReceipts();
  }

  /** Import previously exported server receipts */
  importServerReceipts(data: { serverReceipts: ServerReceipt[] }): void {
    this.tracker.importServerReceipts(data);
  }

  /** Get full policy stats */
  getPolicyStats() {
    return this.policy.getStats();
  }

  /** Reset the circuit breaker */
  resetCircuitBreaker(): void {
    this.policy.resetCircuitBreaker();
  }

  // --- Cleanup ---

  /** Clear private key material from memory */
  destroy(): void {
    this._destroyed = true;
    this.account = null;
    this.removeAllListeners();
  }

  // --- Private helpers ---

  private checkSpendingWarnings(): void {
    const stats = this.policy.getStats();
    const checks: Array<{ period: string; spent: number; limit: number }> = [
      { period: 'day', spent: stats.spending.day, limit: stats.limits.maxPerDay },
      { period: 'week', spent: stats.spending.week, limit: stats.limits.maxPerWeek },
      { period: 'session', spent: stats.spending.session, limit: stats.limits.maxPerSession },
    ];

    for (const { period, spent, limit } of checks) {
      if (limit <= 0) continue;
      const percentUsed = (spent / limit) * 100;
      if (percentUsed >= 80) {
        this.emit('spending:warning', { period, percentUsed, spent, limit });
      }
    }
  }
}
