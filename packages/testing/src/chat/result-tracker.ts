/**
 * Tracks streaming chat results during a test run.
 * Collects tool calls, tool results, and text chunks.
 */

import type { ChatTestResult } from './types.js';

export class ChatResultTracker {
  readonly toolCalls: Array<{ name: string; displayName?: string; args: unknown }> = [];
  readonly toolResults: Array<{ name: string; result?: string; isError: boolean }> = [];
  readonly textChunks: string[] = [];

  /** Returns callback options compatible with ChatOptions from rickydata/agent. */
  get callbacks() {
    return {
      onText: (text: string) => {
        this.textChunks.push(text);
      },
      onToolCall: (tool: { name: string; displayName?: string; args: unknown }) => {
        this.toolCalls.push(tool);
      },
      onToolResult: (result: { name: string; result?: string; isError: boolean }) => {
        this.toolResults.push(result);
      },
    };
  }

  /**
   * Merge tracking data with the ChatResult from the agent.
   * Returns an enriched ChatTestResult for validation.
   */
  toResult(chatResult: { text: string; sessionId: string; cost?: string; toolCallCount?: number; usage?: { inputTokens: number; outputTokens: number } }): ChatTestResult {
    const allToolText = this.toolResults
      .map(r => typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? ''))
      .join(' ');

    let costUsd: number | undefined;
    if (chatResult.cost) {
      const parsed = parseFloat(chatResult.cost.replace(/[^0-9.]/g, ''));
      if (!isNaN(parsed)) costUsd = parsed;
    }

    return {
      text: chatResult.text,
      sessionId: chatResult.sessionId,
      cost: chatResult.cost,
      costUsd,
      toolCallCount: chatResult.toolCallCount ?? this.toolCalls.length,
      toolCalls: [...this.toolCalls],
      toolResults: [...this.toolResults],
      allToolText,
      usage: chatResult.usage,
    };
  }

  /** Reset tracker for reuse across tests. */
  reset(): void {
    this.toolCalls.length = 0;
    this.toolResults.length = 0;
    this.textChunks.length = 0;
  }
}
