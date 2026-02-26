import type { SpendingPolicyConfig, ApprovalDetails } from '../types/config.js';
import type { PolicyResult, PolicyViolationType } from '../types/payment.js';
import { DEFAULT_POLICY } from '../constants.js';

interface PaymentRecord {
  timestamp: number;
  amount: number;
  endpoint?: string;
  toolName?: string;
}

interface RecentPayment {
  timestamp: number;
  endpoint: string;
  amount: number;
}

/**
 * Standalone spending policy validator.
 * Validates payments against configured limits without performing any signing.
 */
export class SpendingPolicy {
  private readonly maxPerCall: number;
  private readonly maxPerSession: number;
  private readonly maxPerDay: number;
  private readonly maxPerWeek: number;
  private readonly allowedEndpoints: string[];
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerCooldownSeconds: number;
  private readonly deduplicationWindowSeconds: number;
  private readonly requireApprovalAbove: number;
  private readonly approvalCallback?: (details: ApprovalDetails) => Promise<boolean>;
  private readonly dryRun: boolean;

  private paymentHistory: PaymentRecord[] = [];
  private sessionSpending = 0;
  private failureCount = 0;
  private failureWindowStart = 0;
  private circuitBreakerTripTime: number | null = null;
  private recentPayments: RecentPayment[] = [];

  constructor(config: SpendingPolicyConfig = {}) {
    this.maxPerCall = config.maxPerCall ?? DEFAULT_POLICY.maxPerCall;
    this.maxPerSession = config.maxPerSession ?? DEFAULT_POLICY.maxPerSession;
    this.maxPerDay = config.maxPerDay ?? DEFAULT_POLICY.maxPerDay;
    this.maxPerWeek = config.maxPerWeek ?? DEFAULT_POLICY.maxPerWeek;
    this.allowedEndpoints = config.allowedEndpoints ?? [];
    this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? DEFAULT_POLICY.circuitBreakerThreshold;
    this.circuitBreakerCooldownSeconds = config.circuitBreakerCooldownSeconds ?? DEFAULT_POLICY.circuitBreakerCooldownSeconds;
    this.deduplicationWindowSeconds = config.deduplicationWindowSeconds ?? DEFAULT_POLICY.deduplicationWindowSeconds;
    this.requireApprovalAbove = config.requireApprovalAbove ?? DEFAULT_POLICY.requireApprovalAbove;
    this.approvalCallback = config.approvalCallback;
    this.dryRun = config.dryRun ?? DEFAULT_POLICY.dryRun;
  }

  /**
   * Validate a payment against all policy rules.
   * Returns a PolicyResult - callers decide whether to throw.
   */
  async validate(amount: number, endpoint?: string, toolName?: string): Promise<PolicyResult> {
    const now = Date.now();

    // 1. Circuit breaker
    const cbResult = this.checkCircuitBreaker(now);
    if (!cbResult.allowed) return cbResult;

    // 2. Endpoint allowlist
    if (endpoint) {
      const epResult = this.checkEndpoint(endpoint);
      if (!epResult.allowed) return epResult;
    }

    // 3. Per-call limit
    if (amount > this.maxPerCall) {
      return reject('CALL_LIMIT', `Payment $${amount} exceeds per-call limit of $${this.maxPerCall}`);
    }

    // 4. Session limit
    if (this.sessionSpending + amount > this.maxPerSession) {
      return reject('SESSION_LIMIT',
        `Payment would exceed session limit of $${this.maxPerSession} (spent: $${this.sessionSpending.toFixed(4)})`);
    }

    // 5. Daily limit
    const daySpent = this.getSpending('day');
    if (daySpent + amount > this.maxPerDay) {
      return reject('DAILY_LIMIT',
        `Payment would exceed daily limit of $${this.maxPerDay} (spent today: $${daySpent.toFixed(4)})`);
    }

    // 6. Weekly limit
    const weekSpent = this.getSpending('week');
    if (weekSpent + amount > this.maxPerWeek) {
      return reject('WEEKLY_LIMIT',
        `Payment would exceed weekly limit of $${this.maxPerWeek} (spent this week: $${weekSpent.toFixed(4)})`);
    }

    // 7. Deduplication
    if (endpoint) {
      const dedupResult = this.checkDeduplication(amount, endpoint, now);
      if (!dedupResult.allowed) return dedupResult;
    }

    // 8. Approval callback
    if (amount > this.requireApprovalAbove && this.approvalCallback) {
      const approved = await this.approvalCallback({
        amountUsd: amount,
        endpoint: endpoint ?? '',
        toolName,
        dailySpending: daySpent,
        weeklySpending: weekSpent,
        sessionSpending: this.sessionSpending,
      });
      if (!approved) {
        return reject('APPROVAL_DECLINED', 'Payment declined by approval callback');
      }
    }

    // 9. Dry run
    if (this.dryRun) {
      return { allowed: true, dryRun: true, message: 'Dry run - payment would be allowed' };
    }

    return { allowed: true };
  }

  /** Record a successful payment */
  recordPayment(amount: number, endpoint?: string, toolName?: string): void {
    const now = Date.now();
    this.paymentHistory.push({ timestamp: now, amount, endpoint, toolName });
    this.sessionSpending += amount;
    if (endpoint) {
      this.recentPayments.push({ timestamp: now, endpoint, amount });
    }
    // Reset circuit breaker on success
    this.failureCount = 0;
  }

  /** Record a payment failure (increments circuit breaker counter) */
  recordFailure(): void {
    const now = Date.now();
    // Reset window if it's been longer than cooldown
    if (now - this.failureWindowStart > this.circuitBreakerCooldownSeconds * 1000) {
      this.failureCount = 0;
      this.failureWindowStart = now;
    }
    if (this.failureCount === 0) {
      this.failureWindowStart = now;
    }
    this.failureCount++;

    if (this.failureCount >= this.circuitBreakerThreshold) {
      this.circuitBreakerTripTime = now;
    }
  }

  /** Reset the circuit breaker manually */
  resetCircuitBreaker(): void {
    this.failureCount = 0;
    this.circuitBreakerTripTime = null;
  }

  /** Get total spending for a time period */
  getSpending(period: 'day' | 'week' | 'session' | 'all'): number {
    if (period === 'session') return this.sessionSpending;
    if (period === 'all') {
      return this.paymentHistory.reduce((sum, r) => sum + r.amount, 0);
    }

    const now = Date.now();
    const cutoff = period === 'day' ? now - 24 * 60 * 60 * 1000 : now - 7 * 24 * 60 * 60 * 1000;
    return this.paymentHistory
      .filter(r => r.timestamp >= cutoff)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /** Get remaining budget for a period */
  getRemaining(period: 'day' | 'week' | 'session'): number {
    const spent = this.getSpending(period);
    const limit = period === 'day' ? this.maxPerDay
      : period === 'week' ? this.maxPerWeek
      : this.maxPerSession;
    return Math.max(0, limit - spent);
  }

  /** Get comprehensive policy stats */
  getStats() {
    return {
      limits: {
        maxPerCall: this.maxPerCall,
        maxPerSession: this.maxPerSession,
        maxPerDay: this.maxPerDay,
        maxPerWeek: this.maxPerWeek,
      },
      spending: {
        session: this.sessionSpending,
        day: this.getSpending('day'),
        week: this.getSpending('week'),
        all: this.getSpending('all'),
      },
      remaining: {
        session: this.getRemaining('session'),
        day: this.getRemaining('day'),
        week: this.getRemaining('week'),
      },
      circuitBreaker: {
        failureCount: this.failureCount,
        threshold: this.circuitBreakerThreshold,
        tripped: this.circuitBreakerTripTime !== null,
      },
      dryRun: this.dryRun,
      totalPayments: this.paymentHistory.length,
    };
  }

  // --- Private validation helpers ---

  private checkCircuitBreaker(now: number): PolicyResult {
    if (this.circuitBreakerTripTime !== null) {
      const elapsed = (now - this.circuitBreakerTripTime) / 1000;
      if (elapsed < this.circuitBreakerCooldownSeconds) {
        return reject('CIRCUIT_BREAKER',
          `Circuit breaker tripped (${this.failureCount} failures). Cooldown: ${Math.ceil(this.circuitBreakerCooldownSeconds - elapsed)}s remaining`);
      }
      // Cooldown expired, auto-reset
      this.resetCircuitBreaker();
    }
    return { allowed: true };
  }

  private checkEndpoint(endpoint: string): PolicyResult {
    if (this.allowedEndpoints.length === 0) return { allowed: true };
    const allowed = this.allowedEndpoints.some(e => endpoint.includes(e));
    if (!allowed) {
      return reject('ENDPOINT_NOT_ALLOWED', `Endpoint not in allowlist: ${endpoint}`);
    }
    return { allowed: true };
  }

  private checkDeduplication(amount: number, endpoint: string, now: number): PolicyResult {
    if (this.deduplicationWindowSeconds <= 0) return { allowed: true };

    // Clean old entries
    const cutoff = now - this.deduplicationWindowSeconds * 1000;
    this.recentPayments = this.recentPayments.filter(p => p.timestamp >= cutoff);

    // Check for duplicate
    const isDuplicate = this.recentPayments.some(
      p => p.endpoint === endpoint && Math.abs(p.amount - amount) < 0.0001,
    );
    if (isDuplicate) {
      return reject('DUPLICATE_PAYMENT',
        `Duplicate payment of $${amount} to ${endpoint} within ${this.deduplicationWindowSeconds}s window`);
    }
    return { allowed: true };
  }
}

function reject(violation: PolicyViolationType, message: string): PolicyResult {
  return { allowed: false, violation, message };
}
