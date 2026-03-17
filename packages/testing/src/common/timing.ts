/**
 * Timing utilities for test output.
 */

/** Returns a human-readable elapsed string like "12.3s". */
export function elapsed(startMs: number): string {
  const ms = Date.now() - startMs;
  return formatDuration(ms);
}

/** Format milliseconds as a readable duration string. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
