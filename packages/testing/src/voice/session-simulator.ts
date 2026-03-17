/**
 * Voice session simulator — replays data channel messages
 * and tracks state transitions + cost without LiveKit infrastructure.
 */

import type { VoicePhase, DataChannelMessage, VoiceTestScenario, VoiceCostSnapshot } from './types.js';
import { calculateExpectedCost } from './cost-validator.js';

export interface VoiceFeeConfig {
  /** Platform fee per minute in USD. Default: $0.02 */
  perMinuteUsd?: number;
  /** Fee per tool call in USD. Default: $0.0005 */
  perToolCallUsd?: number;
}

export interface SimulationResult {
  toolCalls: Array<{ callId: string; name: string; success?: boolean }>;
  costSnapshot: VoiceCostSnapshot;
  phases: VoicePhase[];
  narrations: string[];
}

export class VoiceSessionSimulator {
  private readonly perMinuteUsd: number;
  private readonly perToolCallUsd: number;

  constructor(feeConfig?: VoiceFeeConfig) {
    this.perMinuteUsd = feeConfig?.perMinuteUsd ?? 0.02;
    this.perToolCallUsd = feeConfig?.perToolCallUsd ?? 0.0005;
  }

  /** Run a scenario by replaying its data channel messages and tracking state. */
  async runScenario(scenario: VoiceTestScenario): Promise<SimulationResult> {
    const toolCalls: SimulationResult['toolCalls'] = [];
    const phases: VoicePhase[] = ['idle', 'connecting', 'listening'];
    const narrations: string[] = [];
    const activeToolCalls = new Set<string>();
    let completedToolCallCount = 0;
    let totalDurationMs = 0;

    for (const msg of scenario.dataChannelMessages) {
      // Simulate timing
      if (msg.delayMs) {
        totalDurationMs += msg.delayMs;
      }

      switch (msg.type) {
        case 'tool_call_started': {
          const callId = msg.callId ?? `call-${toolCalls.length}`;
          const name = msg.name ?? 'unknown_tool';
          activeToolCalls.add(callId);
          toolCalls.push({ callId, name });
          phases.push('using_tools');

          // Generate narration
          const humanized = this.humanizeToolName(name);
          narrations.push(`Let me ${humanized}...`);
          break;
        }

        case 'tool_call_completed': {
          const callId = msg.callId ?? '';
          activeToolCalls.delete(callId);
          completedToolCallCount++;

          // Update existing tool call entry
          const existing = toolCalls.find(tc => tc.callId === callId);
          if (existing) {
            existing.success = msg.success ?? true;
          }

          // Phase transition
          if (activeToolCalls.size === 0) {
            phases.push('speaking');
          }

          narrations.push(msg.success !== false ? 'Got the results.' : "That didn't work as expected.");
          break;
        }

        case 'session_cost': {
          // Cost updates don't change phase
          break;
        }

        case 'agent_text': {
          if (activeToolCalls.size === 0) {
            phases.push('speaking');
          }
          break;
        }
      }
    }

    // Calculate cost
    const durationMs = totalDurationMs || this.estimateDurationFromMessages(scenario.dataChannelMessages);
    const costSnapshot = calculateExpectedCost(durationMs, completedToolCallCount, {
      perMinuteUsd: this.perMinuteUsd,
      perToolCallUsd: this.perToolCallUsd,
    });

    return { toolCalls, costSnapshot, phases, narrations };
  }

  private humanizeToolName(name: string): string {
    const segments = name.split('__');
    return segments[segments.length - 1].replace(/_/g, ' ');
  }

  /** Rough duration estimate when explicit delays aren't provided. */
  private estimateDurationFromMessages(messages: DataChannelMessage[]): number {
    // Estimate ~2s per message as a rough heuristic
    return messages.length * 2000;
  }
}
