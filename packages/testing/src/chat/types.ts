/**
 * Chat test case types.
 */

export interface ChatTestCase {
  /** Human-readable test name. */
  name: string;
  /** Agent to test against. */
  agentId: string;
  /** Question to send. */
  question: string;
  /** Model override (defaults to env config). */
  model?: 'haiku' | 'sonnet' | 'opus';
  /** Validation checks to run against the response. */
  validation: ChatValidationChecks;
}

export interface ChatValidationChecks {
  /** Tool names that must appear (substring match on tool name). */
  requiredTools?: string[];
  /** Entity IDs or URLs that must appear in tool results or response text. */
  expectedResources?: string[];
  /** Keywords that MUST appear in the response (case-insensitive). */
  requiredKeywords?: string[];
  /** Patterns that MUST NOT appear in the response (case-insensitive). */
  forbiddenPatterns?: string[];
  /** Source citations that should appear in the response. */
  requiredCitations?: string[];
  /** Minimum response length in characters. */
  minResponseLength?: number;
  /** Maximum cost in USD. */
  maxCostUsd?: number;
  /** Custom validator returning failure messages (empty = pass). */
  custom?: (result: ChatTestResult) => string[];
}

/** Enriched chat result with tracking data for validation. */
export interface ChatTestResult {
  /** Full accumulated text response. */
  text: string;
  /** Session ID. */
  sessionId: string;
  /** Cost string (e.g. "$0.014"). */
  cost?: string;
  /** Numeric cost parsed from the string. */
  costUsd?: number;
  /** Number of MCP tool calls. */
  toolCallCount: number;
  /** All tool calls observed. */
  toolCalls: Array<{ name: string; displayName?: string; args: unknown }>;
  /** All tool results observed. */
  toolResults: Array<{ name: string; result?: string; isError: boolean }>;
  /** Concatenated tool result text (for resource/entity checks). */
  allToolText: string;
  /** Token usage if available. */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatSuiteOptions {
  /** Stop running after the first failure. */
  stopOnFailure?: boolean;
  /** Only run the first N test cases. */
  subset?: number;
}
