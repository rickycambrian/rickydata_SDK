import { useState, useCallback, useRef, useEffect } from 'react';
import { streamSSEEvents, type SSEEvent } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';
import type { ChatMessage, ToolExecution } from '../types.js';

export interface UseAgentChatOptions {
  agentId: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  resumeSessionId?: string;
}

export interface UseAgentChatResult {
  messages: ChatMessage[];
  messagesLoading: boolean;
  sending: boolean;
  sessionId: string | null;
  streamingPhase: 'idle' | 'tools' | 'streaming';
  activeTools: string[];
  apiKeyConfigured: boolean | null;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  refreshApiKeyStatus: () => void;
  /** Create a session eagerly (without sending a message). Enables voice before first chat. */
  ensureSession: () => Promise<string>;
}

/**
 * SSE streaming chat hook. NOT React Query — uses imperative state management.
 *
 * Ported from rickydata_agentbook/src/hooks/useAgentTextChat.ts.
 */
export function useAgentChat({
  agentId,
  model = 'haiku',
  resumeSessionId,
}: UseAgentChatOptions): UseAgentChatResult {
  const client = useRickyData();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(!!resumeSessionId);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(resumeSessionId || null);
  const [streamingPhase, setStreamingPhase] = useState<'idle' | 'tools' | 'streaming'>('idle');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);

  const modelRef = useRef(model);
  modelRef.current = model;
  const messageQueueRef = useRef<string[]>([]);

  // Check API key status on mount
  useEffect(() => {
    let cancelled = false;
    client.getApiKeyStatus()
      .then(({ configured }) => { if (!cancelled) setApiKeyConfigured(configured); })
      .catch(() => { if (!cancelled) setApiKeyConfigured(false); });
    return () => { cancelled = true; };
  }, [client]);

  // Load messages when resuming a session
  useEffect(() => {
    if (!resumeSessionId) return;
    let cancelled = false;
    client.getSession(agentId, resumeSessionId)
      .then(session => {
        if (cancelled) return;
        const msgs: ChatMessage[] = session.messages.map((m, i) => ({
          id: `restored-${i}`,
          role: m.role === 'user' ? 'user' : 'agent',
          content: m.content,
          timestamp: m.timestamp || session.createdAt,
        }));
        setMessages(msgs);
        setMessagesLoading(false);
      })
      .catch(() => { if (!cancelled) setMessagesLoading(false); });
    return () => { cancelled = true; };
  }, [client, agentId, resumeSessionId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (sending) {
      messageQueueRef.current.push(text.trim());
      return;
    }

    // Block if API key not configured
    if (apiKeyConfigured === false) {
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-error`,
        role: 'agent',
        content: 'Anthropic API key required. Configure ANTHROPIC_API_KEY before chatting.',
        timestamp: new Date().toISOString(),
      }]);
      return;
    }

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    setSending(true);

    try {
      let sid = sessionId;
      if (!sid) {
        const session = await client.createSession(agentId, modelRef.current);
        sid = session.id;
        setSessionId(sid);
      }

      const response = await client.chatRaw(agentId, sid, text.trim(), modelRef.current);

      let textAccum = '';
      const toolExecutions: ToolExecution[] = [];
      let messageCost = '';
      let toolIdCounter = 0;
      const streamingMsgId = `agent-streaming-${Date.now()}`;

      setActiveTools([]);
      setStreamingPhase('idle');

      await streamSSEEvents(response, (event: SSEEvent) => {
        switch (event.type) {
          case 'text':
            setStreamingPhase('streaming');
            setActiveTools([]);
            textAccum += event.data;
            setMessages(prev => {
              const existing = prev.find(m => m.id === streamingMsgId);
              if (!existing) {
                return [...prev, {
                  id: streamingMsgId,
                  role: 'agent' as const,
                  content: textAccum,
                  toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined,
                  timestamp: new Date().toISOString(),
                }];
              }
              return prev.map(m =>
                m.id === streamingMsgId
                  ? { ...m, content: textAccum, toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined }
                  : m
              );
            });
            break;
          case 'tool_call': {
            const data = event.data;
            const displayName = data.displayName || data.name.split('__').pop() || data.name;
            toolExecutions.push({
              id: data.id || `tool-${++toolIdCounter}`,
              name: data.name,
              displayName,
              args: data.args,
            });
            setActiveTools(prev => [...prev, displayName]);
            setStreamingPhase('tools');
            break;
          }
          case 'tool_result': {
            const resultData = event.data;
            const resultContent = resultData.result ?? resultData.content;
            let matched = false;
            if (resultData.id) {
              const idx = toolExecutions.findIndex(t => t.id === resultData.id);
              if (idx !== -1) {
                toolExecutions[idx].result = { content: resultContent, isError: resultData.isError };
                matched = true;
              }
            }
            if (!matched) {
              for (let i = toolExecutions.length - 1; i >= 0; i--) {
                if (toolExecutions[i].name === resultData.name && !toolExecutions[i].result) {
                  toolExecutions[i].result = { content: resultContent, isError: resultData.isError };
                  break;
                }
              }
            }
            break;
          }
          case 'done':
            if (event.data.cost) messageCost = event.data.cost as string;
            break;
          case 'error':
            textAccum += `\n\nError: ${event.data.message}`;
            break;
        }
      });

      // Finalize
      setMessages(prev => {
        const withoutStreaming = prev.filter(m => m.id !== streamingMsgId);
        return [...withoutStreaming, {
          id: `msg-${Date.now()}-agent`,
          role: 'agent' as const,
          content: textAccum || '(No response)',
          toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined,
          timestamp: new Date().toISOString(),
          costUSD: messageCost || undefined,
        }];
      });
    } catch (err: unknown) {
      const errStatus = typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status: number }).status : 0;
      const errMessage = err instanceof Error ? err.message : String(err);

      if (errStatus === 402 || /\b402\b/.test(errMessage)) {
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`, role: 'agent',
          content: 'Insufficient balance. Please deposit funds to continue.',
          timestamp: new Date().toISOString(),
        }]);
      } else if (errStatus === 404 || /session not found|not found/i.test(errMessage)) {
        setSessionId(null);
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`, role: 'agent',
          content: 'Session expired. Starting a new conversation...',
          timestamp: new Date().toISOString(),
        }]);
      } else if (errStatus === 401 || /unauthorized|authentication|invalid.*token|expired.*token/i.test(errMessage)) {
        setSessionId(null);
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`, role: 'agent',
          content: 'Re-authenticating... please send again.',
          timestamp: new Date().toISOString(),
        }]);
      } else if (errStatus === 400 && /anthropic api key|required/i.test(errMessage)) {
        setApiKeyConfigured(false);
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`, role: 'agent',
          content: errMessage,
          timestamp: new Date().toISOString(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`, role: 'agent',
          content: `Error: ${errMessage}`,
          timestamp: new Date().toISOString(),
        }]);
      }
    } finally {
      setSending(false);
      setStreamingPhase('idle');
      setActiveTools([]);
      // Process queued messages
      const nextMessage = messageQueueRef.current.shift();
      if (nextMessage) {
        setTimeout(() => sendMessage(nextMessage), 0);
      }
    }
  }, [client, agentId, sessionId, apiKeyConfigured]);

  const refreshApiKeyStatus = useCallback(() => {
    client.getApiKeyStatus()
      .then(({ configured }) => setApiKeyConfigured(configured))
      .catch(() => { /* ignore */ });
  }, [client]);

  // Show success message when API key transitions from unconfigured to configured
  const prevApiKeyRef = useRef(apiKeyConfigured);
  useEffect(() => {
    if (prevApiKeyRef.current === false && apiKeyConfigured === true) {
      setMessages(prev => [...prev, {
        id: `msg-${Date.now()}-system`,
        role: 'agent',
        content: 'API key configured successfully! You can start chatting now.',
        timestamp: new Date().toISOString(),
      }]);
    }
    prevApiKeyRef.current = apiKeyConfigured;
  }, [apiKeyConfigured]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setStreamingPhase('idle');
    setActiveTools([]);
  }, []);

  /**
   * Eagerly create a session without sending a message.
   * Useful for enabling voice or other session-dependent features
   * before the user types their first message.
   */
  const ensureSession = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const session = await client.createSession(agentId, modelRef.current);
    setSessionId(session.id);
    return session.id;
  }, [client, agentId, sessionId]);

  return {
    messages,
    messagesLoading,
    sending,
    sessionId,
    streamingPhase,
    activeTools,
    apiKeyConfigured,
    sendMessage,
    clearChat,
    refreshApiKeyStatus,
    ensureSession,
  };
}
