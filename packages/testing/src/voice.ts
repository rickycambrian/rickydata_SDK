/**
 * @rickydata/testing/voice — Voice-specific exports.
 */

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
