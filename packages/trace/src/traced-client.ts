/**
 * TracedAgentClient — wraps AgentClient to automatically record trace events
 * for every session creation, message send, and SSE stream event.
 */

import type { AgentClient, SSEEvent, SessionCreateResponse, ImageAttachment } from 'rickydata';
import { streamSSEEvents } from 'rickydata';
import { TraceRecorder } from './recorder.js';
import type { TraceRecorderConfig } from './types.js';
import { formatTimestamp } from './utils.js';

export interface TracedAgentClientConfig {
  /** The AgentClient instance to wrap. */
  client: AgentClient;
  /** TraceRecorder configuration overrides. */
  trace?: TraceRecorderConfig;
}

export class TracedAgentClient {
  readonly client: AgentClient;
  readonly trace: TraceRecorder;

  constructor(config: TracedAgentClientConfig) {
    this.client = config.client;
    this.trace = new TraceRecorder(config.trace);
  }

  /** Creates a session and records a session_start trace event. */
  async createSession(agentId: string, model?: string): Promise<SessionCreateResponse> {
    const sessionId = this.trace.startSession(agentId, { model });
    const result = await this.client.createSession(agentId, model);

    // Update the trace session with the real gateway session ID
    this.trace.record({
      type: 'custom',
      sessionId,
      agentId,
      data: { gatewaySessionId: result.id, model: result.model },
    });

    return result;
  }

  /**
   * Sends a chat message via the underlying client and records the send event.
   *
   * @param images - Optional image attachments for multimodal (screenshare) support.
   *   Forwarded directly to the underlying AgentClient.chatRaw call.
   */
  async chatRaw(agentId: string, sessionId: string, message: string, model?: string, images?: ImageAttachment[]): Promise<Response> {
    this.trace.record({
      type: 'message_sent',
      sessionId: this.trace.getActiveSession()?.id,
      agentId,
      data: {
        gatewaySessionId: sessionId,
        message,
        model,
        imageCount: images?.length ?? 0,
        sentAt: formatTimestamp(),
      },
    });

    return this.client.chatRaw(agentId, sessionId, message, model, images);
  }

  /**
   * Wraps streamSSEEvents to record each SSE event to the trace.
   *
   * Records timing from stream start to completion and maps each
   * SSE event type to the corresponding TraceEvent type.
   */
  async streamWithTrace(
    response: Response,
    onEvent: (event: SSEEvent) => void,
    sessionId?: string,
  ): Promise<void> {
    const traceSessionId = sessionId ?? this.trace.getActiveSession()?.id;
    const streamStart = Date.now();

    await streamSSEEvents(response, (event: SSEEvent) => {
      // Map SSE event to trace event
      switch (event.type) {
        case 'text':
          this.trace.record({
            type: 'sse_text',
            sessionId: traceSessionId,
            data: { text: event.data },
          });
          break;

        case 'tool_call':
          this.trace.record({
            type: 'tool_call',
            sessionId: traceSessionId,
            data: {
              name: event.data.name,
              displayName: event.data.displayName,
              args: event.data.args,
              id: event.data.id,
            },
          });
          break;

        case 'tool_result':
          this.trace.record({
            type: 'tool_result',
            sessionId: traceSessionId,
            data: {
              id: event.data.id,
              name: event.data.name,
              isError: event.data.isError,
              result: event.data.result,
            },
          });
          break;

        case 'done':
          this.trace.record({
            type: 'sse_done',
            sessionId: traceSessionId,
            durationMs: Date.now() - streamStart,
            data: {
              cost: event.data.cost,
              costRaw: event.data.costRaw,
              balanceRemaining: event.data.balanceRemaining,
              usage: event.data.usage,
              toolCallCount: event.data.toolCallCount,
            },
          });
          break;

        case 'error':
          this.trace.record({
            type: 'error',
            sessionId: traceSessionId,
            durationMs: Date.now() - streamStart,
            data: {
              code: event.data.code,
              message: event.data.message,
            },
          });
          break;
      }

      // Forward to the caller's handler
      onEvent(event);
    });
  }
}
