import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamSSEEvents, type SSEEvent } from 'rickydata/agent';
import { useChatBubbleConfig } from '../providers/ChatBubbleProvider.js';
import { useAgentActions } from '../stores/actions.js';
import type { ChatMessage, ToolExecution, ChatContext } from '../types/chat.js';
import type { ActionProposal } from '../types/actions.js';
import type { ChatBubbleEvent } from '../types/events.js';

export interface UseChatBubbleEngineOptions {
  /** Chat context for contextual mode. Omit for generic chat. */
  context?: ChatContext | null;
  /** Gateway token from useWalletAuth. */
  gatewayToken?: string | null;
}

export interface UseChatBubbleEngineReturn {
  sessionId: string | null;
  messages: ChatMessage[];
  input: string;
  streaming: boolean;
  loading: boolean;
  error: string | null;
  streamingPhase: 'idle' | 'tools' | 'streaming';
  activeTools: string[];
  isContextual: boolean;

  setInput: (value: string) => void;
  sendMessage: () => Promise<void>;
  clearChat: () => void;
  clearError: () => void;
  abort: () => void;
}

/**
 * Core chat engine hook — rewritten from useChatEngine to use SDK's AgentClient directly.
 * No Express API proxy needed — communicates with Agent Gateway via AgentClient.
 */
export function useChatBubbleEngine({
  context,
  gatewayToken,
}: UseChatBubbleEngineOptions = {}): UseChatBubbleEngineReturn {
  const { client, config } = useChatBubbleConfig();
  const agentId = config.agentId;
  const model = config.model ?? 'haiku';

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingPhase, setStreamingPhase] = useState<'idle' | 'tools' | 'streaming'>('idle');
  const [activeTools, setActiveTools] = useState<string[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const onNavigateRef = useRef(config.callbacks?.onNavigate);
  onNavigateRef.current = config.callbacks?.onNavigate;
  const onRevalidateRef = useRef(config.callbacks?.onRevalidate);
  onRevalidateRef.current = config.callbacks?.onRevalidate;
  const onCustomEventRef = useRef(config.callbacks?.onCustomEvent);
  onCustomEventRef.current = config.callbacks?.onCustomEvent;

  const isContextual = !!context && context.type !== 'general';

  useEffect(() => {
    client.setAuthToken(gatewayToken ?? null);
  }, [client, gatewayToken]);

  // Create session on mount
  useEffect(() => {
    const walletAddr = config.wallet.getAddress();
    if (!walletAddr || !gatewayToken) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const session = await client.createSession(agentId, model);
        if (cancelled) return;
        setSessionId(session.id);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Failed to create session';
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [agentId, model, client, config.wallet, gatewayToken]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(async () => {
    if (streaming || !input.trim()) return;

    const text = input.trim();
    setInput('');
    setError(null);

    const optimisticUserId = `user-${Date.now()}`;
    const optimisticAssistantId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: optimisticUserId,
        role: 'user',
        content: text,
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
      if (gatewayToken) client.setAuthToken(gatewayToken);
      let sid = sessionId;
      if (!sid) {
        const session = await client.createSession(agentId, model);
        sid = session.id;
        setSessionId(sid);
      }

      const response = await client.chatRaw(agentId, sid, text, model);

      let textAccum = '';
      const toolExecutions: ToolExecution[] = [];
      let toolIdCounter = 0;

      await streamSSEEvents(response, (event: SSEEvent) => {
        // Check abort
        if (controller.signal.aborted) return;

        // Forward custom events
        onCustomEventRef.current?.({
          type: event.type,
          data: event.data,
        } as ChatBubbleEvent);

        switch (event.type) {
          case 'text': {
            setStreamingPhase('streaming');
            setActiveTools([]);
            textAccum += event.data;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === optimisticAssistantId
                  ? { ...msg, content: textAccum, toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined }
                  : msg,
              ),
            );
            break;
          }

          case 'tool_call': {
            const data = event.data;
            const name = data.name;
            const id = data.id || `tool-${++toolIdCounter}`;
            const displayName = data.displayName || name.split('__').pop() || name;
            const args = data.args ?? {};

            toolExecutions.push({ id, name, displayName, args });
            setActiveTools((prev) => [...prev, displayName]);
            setStreamingPhase('tools');

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== optimisticAssistantId) return msg;
                const existing = msg.toolExecutions || [];
                if (existing.some((tool) => tool.id === id)) return msg;
                return {
                  ...msg,
                  toolExecutions: [...existing, { id, name, displayName, args }],
                };
              }),
            );
            break;
          }

          case 'tool_result': {
            const data = event.data;
            const id = data.id ?? '';
            const name = data.name ?? 'tool_result';
            const isError = Boolean(data.isError);
            const rawContent = data.result ?? data.content ?? '';
            const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

            // Match by id first, then by name
            let matched = false;
            if (id) {
              const idx = toolExecutions.findIndex((t) => t.id === id);
              if (idx !== -1) {
                toolExecutions[idx].result = { content, isError };
                matched = true;
              }
            }
            if (!matched) {
              for (let i = toolExecutions.length - 1; i >= 0; i--) {
                if (toolExecutions[i].name === name && !toolExecutions[i].result) {
                  toolExecutions[i].result = { content, isError };
                  break;
                }
              }
            }

            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== optimisticAssistantId) return msg;
                return { ...msg, toolExecutions: [...toolExecutions] };
              }),
            );
            break;
          }

          case 'done':
            break;

          case 'error':
            setError((event.data as { message?: string }).message || 'Stream error');
            break;
        }
      });

      // Finalize: replace streaming message with final version
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === optimisticAssistantId
            ? {
                ...msg,
                content: textAccum || (toolExecutions.length > 0 ? '' : '(No response)'),
                toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined,
              }
            : msg,
        ),
      );
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : 'Failed to send message';
        const isQuotaError = /quota|402|balance|budget|payment/i.test(msg);
        setError(
          isQuotaError
            ? 'The AI assistant is temporarily unavailable (quota limit reached). Please try again later.'
            : msg,
        );
      }
    } finally {
      setStreaming(false);
      setStreamingPhase('idle');
      setActiveTools([]);
      abortRef.current = null;
    }
  }, [streaming, input, sessionId, agentId, model, client, gatewayToken]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setStreamingPhase('idle');
    setActiveTools([]);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    sessionId,
    messages,
    input,
    streaming,
    loading,
    error,
    streamingPhase,
    activeTools,
    isContextual,

    setInput,
    sendMessage,
    clearChat,
    clearError,
    abort,
  };
}
