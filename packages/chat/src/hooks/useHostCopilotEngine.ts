import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentClient, SSEEvent } from 'rickydata/agent';
import { streamSSEEvents } from 'rickydata/agent';
import { useAgentActions } from '../stores/actions.js';
import type { ChatEngine, ChatMessage, ToolExecution } from '../types/chat.js';
import type { ChatBubbleEvent } from '../types/events.js';
import type { AgentActionRequest, AgentHostAdapter } from '../types/host.js';
import { applyHostEvent } from '../host/apply.js';
import { buildHostContextMessage, extractHostDirectives } from '../host/protocol.js';

export interface UseHostCopilotEngineOptions {
  client: AgentClient;
  agentId: string;
  host: AgentHostAdapter;
  model?: 'haiku' | 'sonnet' | 'opus' | (string & {});
  onEvent?: (event: ChatBubbleEvent) => void;
}

export interface UseHostCopilotEngineReturn extends ChatEngine {
  sessionId: string | null;
  streamingPhase: 'idle' | 'tools' | 'streaming';
  activeTools: string[];
  clearChat: () => void;
  abort: () => void;
}

function dispatchHostEvent(event: ChatBubbleEvent, host: AgentHostAdapter, onEvent?: (event: ChatBubbleEvent) => void) {
  onEvent?.(event);
  applyHostEvent(event as Parameters<typeof applyHostEvent>[0], { host });
}

export function createHostActionHandler(host: AgentHostAdapter) {
  return async (proposal: AgentActionRequest) => {
    if (!host.executeAction) {
      throw new Error('Host adapter does not support confirmed actions');
    }
    const result = await host.executeAction(proposal);
    if (result.status !== 'completed') {
      throw new Error(result.message || `Action ${proposal.actionType} did not complete`);
    }
    return {
      confirmed: true,
      revalidateKeys: result.revalidateKeys,
    };
  };
}

export function useHostCopilotEngine({
  client,
  agentId,
  host,
  model = 'haiku',
  onEvent,
}: UseHostCopilotEngineOptions): UseHostCopilotEngineReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingPhase, setStreamingPhase] = useState<'idle' | 'tools' | 'streaming'>('idle');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setError(null);
    setStreaming(false);
    setStreamingPhase('idle');
    setActiveTools([]);
    useAgentActions.getState().clearHighlights();
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setStreamingPhase('idle');
    setActiveTools([]);
  }, []);

  const sendMessage = useCallback(async () => {
    if (streaming || !input.trim()) return;

    const plainText = input.trim();
    const hostMessage = buildHostContextMessage(plainText, host.getContextSnapshot());
    const optimisticUserId = `user-${Date.now()}`;
    const optimisticAssistantId = `assistant-${Date.now()}`;
    const toolExecutions: ToolExecution[] = [];
    let toolIdCounter = 0;
    let textAccum = '';

    setInput('');
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticUserId,
        role: 'user',
        content: plainText,
        source: 'text',
        created_at: new Date().toISOString(),
      },
      {
        id: optimisticAssistantId,
        role: 'assistant',
        content: '',
        source: 'text',
        created_at: new Date().toISOString(),
        toolExecutions: [],
      },
    ]);
    setStreaming(true);
    setStreamingPhase('idle');
    setActiveTools([]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let resolvedSessionId = sessionId;
      if (!resolvedSessionId) {
        setLoading(true);
        const session = await client.createSession(agentId, model);
        resolvedSessionId = session.id;
        setSessionId(session.id);
        setLoading(false);
      }

      const response = await client.chatRaw(agentId, resolvedSessionId, hostMessage, model);
      await streamSSEEvents(response, (event: SSEEvent) => {
        if (controller.signal.aborted) return;

        if (event.type === 'text') {
          setStreamingPhase('streaming');
          textAccum += event.data;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === optimisticAssistantId
                ? {
                    ...msg,
                    content: textAccum,
                    toolExecutions: toolExecutions.length ? [...toolExecutions] : undefined,
                  }
                : msg,
            ),
          );
          return;
        }

        if (event.type === 'tool_call') {
          const id = event.data.id || `tool-${++toolIdCounter}`;
          const name = event.data.name;
          const displayName = event.data.displayName || name.split('__').pop() || name;
          toolExecutions.push({ id, name, displayName, args: event.data.args });
          setActiveTools((prev) => [...prev, displayName]);
          setStreamingPhase('tools');
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === optimisticAssistantId
                ? { ...msg, toolExecutions: [...toolExecutions] }
                : msg,
            ),
          );
          return;
        }

        if (event.type === 'tool_result') {
          const idx = toolExecutions.findIndex((tool) => tool.id === event.data.id);
          if (idx !== -1) {
            toolExecutions[idx].result = {
              content: typeof event.data.result === 'string' ? event.data.result : (event.data.content || ''),
              isError: event.data.isError,
            };
          }
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === optimisticAssistantId
                ? { ...msg, toolExecutions: [...toolExecutions] }
                : msg,
            ),
          );
          return;
        }

        if (event.type === 'error') {
          setError(event.data.message || 'Stream error');
        }
      });

      const parsed = extractHostDirectives(textAccum);
      parsed.events.forEach((event) => dispatchHostEvent(event, host, onEvent));
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === optimisticAssistantId
            ? {
                ...msg,
                content: parsed.cleanText || '(No response)',
                toolExecutions: toolExecutions.length ? [...toolExecutions] : undefined,
              }
            : msg,
        ),
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      }
    } finally {
      setStreaming(false);
      setLoading(false);
      setStreamingPhase('idle');
      setActiveTools([]);
      abortRef.current = null;
    }
  }, [agentId, client, host, input, model, onEvent, sessionId, streaming]);

  return {
    sessionId,
    messages,
    input,
    streaming,
    loading,
    error,
    streamingPhase,
    activeTools,
    isContextual: true,
    setInput,
    sendMessage,
    clearChat,
    clearError,
    abort,
  };
}
