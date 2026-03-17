/**
 * Data channel mock helpers — produce Uint8Array payloads
 * matching the LiveKit data channel JSON format.
 */

import type { DataChannelMessage } from './types.js';

const encoder = new TextEncoder();

/** Encode a DataChannelMessage to Uint8Array (matching LiveKit data channel format). */
export function encodeDataChannelMessage(msg: DataChannelMessage): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

/** Create a tool_call_started payload. */
export function createToolCallStartedPayload(
  callId: string,
  name: string,
  args?: Record<string, unknown>,
): Uint8Array {
  return encodeDataChannelMessage({
    type: 'tool_call_started',
    callId,
    name,
    arguments: args ?? {},
  });
}

/** Create a tool_call_completed payload. */
export function createToolCallCompletedPayload(
  callId: string,
  success = true,
  result?: string,
): Uint8Array {
  return encodeDataChannelMessage({
    type: 'tool_call_completed',
    callId,
    success,
    result,
  });
}

/** Create a session_cost payload. */
export function createSessionCostPayload(cost: string): Uint8Array {
  return encodeDataChannelMessage({
    type: 'session_cost',
    cost,
  });
}

/** Create an agent_text payload. */
export function createAgentTextPayload(text: string): Uint8Array {
  return encodeDataChannelMessage({
    type: 'agent_text',
    text,
  });
}
