/**
 * Shared types for the @rickydata/testing harness.
 */

export interface TestEnvConfig {
  /** Wallet private key (0x-prefixed hex). */
  privateKey: string;
  /** Agent Gateway URL. Defaults to https://agents.rickydata.org */
  gatewayUrl: string;
  /** Default model for test runs. */
  model: 'haiku' | 'sonnet' | 'opus';
  /** Per-test timeout in ms. */
  timeout: number;
}

export interface TestResult {
  /** Test case name. */
  name: string;
  /** Whether the test passed. */
  passed: boolean;
  /** List of failure messages (empty if passed). */
  failures: string[];
  /** Wall-clock time in ms. */
  elapsedMs: number;
  /** Cost string from agent (e.g. "$0.014"). */
  cost?: string;
  /** Number of MCP tool calls made. */
  toolCallCount: number;
  /** Arbitrary metadata for custom checks. */
  metadata: Record<string, unknown>;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  results: TestResult[];
  totalElapsedMs: number;
}
