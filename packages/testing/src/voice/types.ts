/**
 * Voice testing types.
 * Re-declares VoicePhase locally to avoid React peer dep.
 */

export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'using_tools' | 'speaking';

export interface DataChannelMessage {
  type: 'tool_call_started' | 'tool_call_completed' | 'session_cost' | 'agent_text';
  callId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  success?: boolean;
  result?: string;
  cost?: string;
  text?: string;
  /** Optional delay in ms before processing this message (simulates real timing). */
  delayMs?: number;
}

export interface VoiceTestScenario {
  /** Human-readable scenario name. */
  name: string;
  /** Sequence of data channel messages to replay. */
  dataChannelMessages: DataChannelMessage[];
  /** Expected total cost (approximate). */
  expectedCost?: number;
  /** Expected final phase after all messages are processed. */
  expectedFinalPhase?: VoicePhase;
}

export interface VoiceCostSnapshot {
  /** Duration in minutes. */
  durationMin: number;
  /** Total tool calls made. */
  toolCalls: number;
  /** Platform fee component. */
  platformFee: number;
  /** Tool call fee component. */
  toolCallFee: number;
  /** Total estimated cost in USD. */
  totalEstimated: number;
}
