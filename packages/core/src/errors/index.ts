import type { PolicyViolationType } from '../types/payment.js';

/** Base error for all MCP Gateway SDK errors */
export class MCPGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPGatewayError';
  }
}

/** Base error for spending policy violations */
export class SpendingPolicyError extends MCPGatewayError {
  public readonly violation: PolicyViolationType;

  constructor(violation: PolicyViolationType, message: string) {
    super(message);
    this.name = 'SpendingPolicyError';
    this.violation = violation;
  }
}

/** Thrown when a payment exceeds a spending limit */
export class SpendingLimitExceededError extends SpendingPolicyError {
  constructor(
    violation: 'CALL_LIMIT' | 'SESSION_LIMIT' | 'DAILY_LIMIT' | 'WEEKLY_LIMIT',
    message: string,
  ) {
    super(violation, message);
    this.name = 'SpendingLimitExceededError';
  }
}

/** Thrown when a payment targets a non-allowed endpoint */
export class EndpointNotAllowedError extends SpendingPolicyError {
  constructor(endpoint: string) {
    super('ENDPOINT_NOT_ALLOWED', `Endpoint not in allowlist: ${endpoint}`);
    this.name = 'EndpointNotAllowedError';
  }
}

/** Thrown when a duplicate payment is detected */
export class DuplicatePaymentError extends SpendingPolicyError {
  constructor(endpoint: string, amount: number) {
    super('DUPLICATE_PAYMENT', `Duplicate payment of $${amount} to ${endpoint} within deduplication window`);
    this.name = 'DuplicatePaymentError';
  }
}

/** Thrown when the circuit breaker is tripped */
export class CircuitBreakerTrippedError extends SpendingPolicyError {
  constructor(failureCount: number) {
    super('CIRCUIT_BREAKER', `Circuit breaker tripped after ${failureCount} consecutive failures`);
    this.name = 'CircuitBreakerTrippedError';
  }
}

/** Thrown when payment signing fails */
export class PaymentSigningError extends MCPGatewayError {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentSigningError';
  }
}

/** Thrown on non-OK HTTP responses from the Canvas API */
export class CanvasHttpError extends MCPGatewayError {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CanvasHttpError';
    this.status = status;
  }
}

/** Thrown when a vault secret operation fails */
export class VaultError extends MCPGatewayError {
  public readonly status: number;
  public readonly serverId: string;
  constructor(status: number, serverId: string, message: string) {
    super(message);
    this.name = 'VaultError';
    this.status = status;
    this.serverId = serverId;
  }
}
