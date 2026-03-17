import { describe, it, expect } from 'vitest';
import { calculateExpectedCost, validateCostWithinRange } from '../src/voice/cost-validator.js';

describe('calculateExpectedCost', () => {
  it('calculates cost for a 5-minute session with 3 tool calls', () => {
    const cost = calculateExpectedCost(5 * 60_000, 3);

    expect(cost.durationMin).toBe(5);
    expect(cost.toolCalls).toBe(3);
    expect(cost.platformFee).toBeCloseTo(0.10, 4);       // 5 * $0.02
    expect(cost.toolCallFee).toBeCloseTo(0.0015, 4);     // 3 * $0.0005
    expect(cost.totalEstimated).toBeCloseTo(0.1015, 4);
  });

  it('calculates cost for zero duration', () => {
    const cost = calculateExpectedCost(0, 0);

    expect(cost.durationMin).toBe(0);
    expect(cost.totalEstimated).toBe(0);
  });

  it('calculates cost for 30 seconds with no tool calls', () => {
    const cost = calculateExpectedCost(30_000, 0);

    expect(cost.durationMin).toBe(0.5);
    expect(cost.platformFee).toBeCloseTo(0.01, 4);
    expect(cost.toolCallFee).toBe(0);
    expect(cost.totalEstimated).toBeCloseTo(0.01, 4);
  });

  it('uses custom fee config', () => {
    const cost = calculateExpectedCost(60_000, 1, {
      perMinuteUsd: 0.10,
      perToolCallUsd: 0.01,
    });

    expect(cost.platformFee).toBeCloseTo(0.10, 4);
    expect(cost.toolCallFee).toBeCloseTo(0.01, 4);
    expect(cost.totalEstimated).toBeCloseTo(0.11, 4);
  });

  it('handles large values', () => {
    const cost = calculateExpectedCost(60 * 60_000, 100); // 1 hour, 100 tool calls

    expect(cost.durationMin).toBe(60);
    expect(cost.platformFee).toBeCloseTo(1.20, 2);
    expect(cost.toolCallFee).toBeCloseTo(0.05, 4);
  });
});

describe('validateCostWithinRange', () => {
  it('passes when actual matches expected', () => {
    const expected = calculateExpectedCost(5 * 60_000, 3);
    const failures = validateCostWithinRange(expected, expected);
    expect(failures).toEqual([]);
  });

  it('passes when actual is within tolerance', () => {
    const expected = calculateExpectedCost(5 * 60_000, 3);
    const actual = { ...expected, totalEstimated: expected.totalEstimated * 1.1 }; // 10% over
    const failures = validateCostWithinRange(actual, expected, 20);
    expect(failures).toEqual([]);
  });

  it('fails when actual exceeds tolerance', () => {
    const expected = calculateExpectedCost(5 * 60_000, 3);
    const actual = { ...expected, totalEstimated: expected.totalEstimated * 2 }; // 100% over
    const failures = validateCostWithinRange(actual, expected, 20);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toContain('outside expected range');
  });

  it('fails when tool call count mismatches', () => {
    const expected = calculateExpectedCost(5 * 60_000, 3);
    const actual = { ...expected, toolCalls: 5 };
    const failures = validateCostWithinRange(actual, expected);
    expect(failures.some(f => f.includes('Tool call count'))).toBe(true);
  });
});
