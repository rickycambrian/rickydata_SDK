/**
 * @rickydata/testing — Shared agent test harness for chat and voice.
 *
 * Main entry point re-exports common utilities plus both modules.
 */

// Common
export type { TestEnvConfig, TestResult, TestSummary } from './common/types.js';
export { loadTestEnv, requireEnv } from './common/env.js';
export { retryWithBackoff } from './common/retry.js';
export type { RetryOptions } from './common/retry.js';
export { elapsed, formatDuration } from './common/timing.js';
export { ConsoleReporter } from './common/reporter.js';

// Chat
export type {
  ChatTestCase,
  ChatValidationChecks,
  ChatTestResult,
  ChatSuiteOptions,
} from './chat/types.js';
export { ChatResultTracker } from './chat/result-tracker.js';
export {
  checkRequiredTools,
  checkExpectedResources,
  checkRequiredKeywords,
  checkForbiddenPatterns,
  checkRequiredCitations,
  checkMinResponseLength,
  checkMaxCost,
  runAllChecks,
} from './chat/validators.js';
export { ChatTestRunner } from './chat/test-runner.js';
export type { ChatClient, ChatTestRunnerConfig } from './chat/test-runner.js';
export {
  createSSEStream,
  mockAuthFlow,
  mockSessionCreation,
  mockChatResponse,
  TEST_PRIVATE_KEY,
  TEST_WALLET_ADDRESS,
  DEFAULT_GATEWAY_URL,
} from './chat/mocks.js';

// Voice
export type {
  VoicePhase,
  DataChannelMessage,
  VoiceTestScenario,
  VoiceCostSnapshot,
} from './voice/types.js';
export { VoiceSessionSimulator } from './voice/session-simulator.js';
export type { VoiceFeeConfig, SimulationResult } from './voice/session-simulator.js';
export { calculateExpectedCost, validateCostWithinRange } from './voice/cost-validator.js';
export type { CostConfig } from './voice/cost-validator.js';
export { assertNoMarkdown, assertPhaseTransition } from './voice/narration-validator.js';
export {
  encodeDataChannelMessage,
  createToolCallStartedPayload,
  createToolCallCompletedPayload,
  createSessionCostPayload,
  createAgentTextPayload,
} from './voice/data-channel-mock.js';
