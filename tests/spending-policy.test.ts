import { describe, it, expect, vi } from 'vitest';
import { SpendingPolicy } from '../src/wallet/spending-policy.js';

describe('SpendingPolicy', () => {
  it('allows payments within limits', async () => {
    const policy = new SpendingPolicy({ maxPerCall: 0.01 });
    const result = await policy.validate(0.005);
    expect(result.allowed).toBe(true);
  });

  it('rejects payments exceeding per-call limit', async () => {
    const policy = new SpendingPolicy({ maxPerCall: 0.01 });
    const result = await policy.validate(0.02);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('CALL_LIMIT');
  });

  it('rejects payments exceeding session limit', async () => {
    const policy = new SpendingPolicy({ maxPerSession: 0.05, maxPerCall: 1 });
    policy.recordPayment(0.04);
    const result = await policy.validate(0.02);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('SESSION_LIMIT');
  });

  it('rejects payments exceeding daily limit', async () => {
    const policy = new SpendingPolicy({ maxPerDay: 0.10, maxPerCall: 1, maxPerSession: 100 });
    policy.recordPayment(0.08);
    const result = await policy.validate(0.05);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('DAILY_LIMIT');
  });

  it('rejects payments exceeding weekly limit', async () => {
    const policy = new SpendingPolicy({ maxPerWeek: 0.10, maxPerCall: 1, maxPerSession: 100, maxPerDay: 100 });
    policy.recordPayment(0.08);
    const result = await policy.validate(0.05);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('WEEKLY_LIMIT');
  });

  it('enforces endpoint allowlist', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1,
      allowedEndpoints: ['34.59.1.154'],
    });
    const allowed = await policy.validate(0.001, 'http://34.59.1.154:8080');
    expect(allowed.allowed).toBe(true);

    const blocked = await policy.validate(0.001, 'http://evil.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.violation).toBe('ENDPOINT_NOT_ALLOWED');
  });

  it('allows all endpoints when allowlist is empty', async () => {
    const policy = new SpendingPolicy({ maxPerCall: 1 });
    const result = await policy.validate(0.001, 'http://any-server.com');
    expect(result.allowed).toBe(true);
  });

  it('detects duplicate payments within window', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      deduplicationWindowSeconds: 60,
    });
    policy.recordPayment(0.001, 'http://gateway.com');

    const result = await policy.validate(0.001, 'http://gateway.com');
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('DUPLICATE_PAYMENT');
  });

  it('allows different amount to same endpoint (not duplicate)', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      deduplicationWindowSeconds: 60,
    });
    policy.recordPayment(0.001, 'http://gateway.com');

    // Different amount — not a duplicate
    const result = await policy.validate(0.002, 'http://gateway.com');
    expect(result.allowed).toBe(true);
  });

  it('trips circuit breaker after threshold failures', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, circuitBreakerThreshold: 3, circuitBreakerCooldownSeconds: 300,
    });

    policy.recordFailure();
    policy.recordFailure();
    policy.recordFailure();

    const result = await policy.validate(0.001);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('CIRCUIT_BREAKER');
  });

  it('resets circuit breaker manually', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, circuitBreakerThreshold: 2, circuitBreakerCooldownSeconds: 300,
    });

    policy.recordFailure();
    policy.recordFailure();

    let result = await policy.validate(0.001);
    expect(result.allowed).toBe(false);

    policy.resetCircuitBreaker();
    result = await policy.validate(0.001);
    expect(result.allowed).toBe(true);
  });

  it('resets circuit breaker on successful payment', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      circuitBreakerThreshold: 5,
    });

    policy.recordFailure();
    policy.recordFailure();
    policy.recordPayment(0.001); // success resets counter

    // Should be able to fail 4 more times before trip
    policy.recordFailure();
    policy.recordFailure();
    const result = await policy.validate(0.001);
    expect(result.allowed).toBe(true);
  });

  it('auto-resets circuit breaker after cooldown expires', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
      circuitBreakerThreshold: 2,
      circuitBreakerCooldownSeconds: 0.1, // 100ms cooldown
    });

    policy.recordFailure();
    policy.recordFailure();

    // Circuit breaker tripped
    let result = await policy.validate(0.001);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('CIRCUIT_BREAKER');

    // Wait for cooldown to expire
    await new Promise(r => setTimeout(r, 150));

    // Auto-resets on next validate() call
    result = await policy.validate(0.001);
    expect(result.allowed).toBe(true);
    expect(policy.getStats().circuitBreaker.tripped).toBe(false);
  });

  it('calls approval callback for amounts above threshold', async () => {
    const callback = vi.fn().mockResolvedValue(true);
    const policy = new SpendingPolicy({
      maxPerCall: 1, requireApprovalAbove: 0.05,
      approvalCallback: callback,
    });

    // Below threshold — no callback
    await policy.validate(0.01);
    expect(callback).not.toHaveBeenCalled();

    // Above threshold — callback called
    await policy.validate(0.06);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ amountUsd: 0.06 }));
  });

  it('rejects when approval callback returns false', async () => {
    const callback = vi.fn().mockResolvedValue(false);
    const policy = new SpendingPolicy({
      maxPerCall: 1, requireApprovalAbove: 0.01,
      approvalCallback: callback,
    });

    const result = await policy.validate(0.02);
    expect(result.allowed).toBe(false);
    expect(result.violation).toBe('APPROVAL_DECLINED');
  });

  it('dry run mode allows but marks as dry run', async () => {
    const policy = new SpendingPolicy({ maxPerCall: 1, dryRun: true });
    const result = await policy.validate(0.001);
    expect(result.allowed).toBe(true);
    expect(result.dryRun).toBe(true);
  });

  it('getSpending returns correct values', () => {
    const policy = new SpendingPolicy({ maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100 });
    policy.recordPayment(0.01);
    policy.recordPayment(0.02);

    expect(policy.getSpending('session')).toBeCloseTo(0.03);
    expect(policy.getSpending('day')).toBeCloseTo(0.03);
    expect(policy.getSpending('week')).toBeCloseTo(0.03);
    expect(policy.getSpending('all')).toBeCloseTo(0.03);
  });

  it('getRemaining returns correct values', () => {
    const policy = new SpendingPolicy({
      maxPerCall: 1, maxPerSession: 1.0, maxPerDay: 5.0, maxPerWeek: 20.0,
    });
    policy.recordPayment(0.5);

    expect(policy.getRemaining('session')).toBeCloseTo(0.5);
    expect(policy.getRemaining('day')).toBeCloseTo(4.5);
    expect(policy.getRemaining('week')).toBeCloseTo(19.5);
  });

  it('getStats returns comprehensive data', () => {
    const policy = new SpendingPolicy({
      maxPerCall: 0.01, maxPerSession: 1, maxPerDay: 5, maxPerWeek: 20,
      circuitBreakerThreshold: 5,
    });
    policy.recordPayment(0.005);

    const stats = policy.getStats();
    expect(stats.limits.maxPerCall).toBe(0.01);
    expect(stats.spending.session).toBeCloseTo(0.005);
    expect(stats.remaining.session).toBeCloseTo(0.995);
    expect(stats.circuitBreaker.tripped).toBe(false);
    expect(stats.totalPayments).toBe(1);
  });

  it('allows unlimited when no limits set', async () => {
    const policy = new SpendingPolicy({
      maxPerCall: Infinity, maxPerSession: Infinity,
      maxPerDay: Infinity, maxPerWeek: Infinity,
    });
    const result = await policy.validate(9999);
    expect(result.allowed).toBe(true);
  });
});
