/**
 * @rickydata/testing/chat — Chat-specific exports.
 */

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
