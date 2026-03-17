/**
 * Voice cost calculation and validation.
 */

import type { VoiceCostSnapshot } from './types.js';

export interface CostConfig {
  /** Platform fee per minute in USD. Default: $0.02 */
  perMinuteUsd?: number;
  /** Fee per tool call in USD. Default: $0.0005 */
  perToolCallUsd?: number;
}

const DEFAULT_PER_MINUTE = 0.02;
const DEFAULT_PER_TOOL_CALL = 0.0005;

/** Calculate expected voice session cost from duration and tool calls. */
export function calculateExpectedCost(
  durationMs: number,
  toolCallCount: number,
  config?: CostConfig,
): VoiceCostSnapshot {
  const perMinute = config?.perMinuteUsd ?? DEFAULT_PER_MINUTE;
  const perToolCall = config?.perToolCallUsd ?? DEFAULT_PER_TOOL_CALL;

  const durationMin = durationMs / 60_000;
  const platformFee = durationMin * perMinute;
  const toolCallFee = toolCallCount * perToolCall;

  return {
    durationMin,
    toolCalls: toolCallCount,
    platformFee,
    toolCallFee,
    totalEstimated: platformFee + toolCallFee,
  };
}

/**
 * Validate that actual cost is within an acceptable range of expected cost.
 * Returns failure messages (empty = pass).
 */
export function validateCostWithinRange(
  actual: VoiceCostSnapshot,
  expected: VoiceCostSnapshot,
  tolerancePercent = 20,
): string[] {
  const failures: string[] = [];
  const tolerance = expected.totalEstimated * (tolerancePercent / 100);
  const lowerBound = expected.totalEstimated - tolerance;
  const upperBound = expected.totalEstimated + tolerance;

  if (actual.totalEstimated < lowerBound || actual.totalEstimated > upperBound) {
    failures.push(
      `Cost $${actual.totalEstimated.toFixed(4)} outside expected range ` +
      `[$${lowerBound.toFixed(4)}, $${upperBound.toFixed(4)}] ` +
      `(expected $${expected.totalEstimated.toFixed(4)} ± ${tolerancePercent}%)`,
    );
  }

  if (actual.toolCalls !== expected.toolCalls) {
    failures.push(
      `Tool call count mismatch: got ${actual.toolCalls}, expected ${expected.toolCalls}`,
    );
  }

  return failures;
}
