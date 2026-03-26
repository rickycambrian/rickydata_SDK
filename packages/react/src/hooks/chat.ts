import { useState, useCallback, useRef, useEffect } from 'react';
import { streamSSEEvents, AgentError, AgentErrorCode, type SSEEvent, type ImageAttachment } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';
import type { ChatMessage, ChatImage, ToolExecution } from '../types.js';

// ─── Tool Approval / Transaction Signing Data ────────────────

export interface ToolApprovalData {
  approvalId: string;
  toolName: string;
  args: unknown;
  description?: string;
  timeoutMs?: number;
}

export interface TransactionSigningData {
  approvalId: string;
  description: string;
  toolName: string;
  metadata?: Record<string, unknown>;
  timeoutMs: number;
}

// ─── Sidebar State ───────────────────────────────────────────

export interface ChatSidebarState {
  selectedModel: string;
  sessionId: string | null;
  messageCount: number;
  totalCost: number;
  streamingPhase: 'idle' | 'tools' | 'streaming';
  activeTools: string[];
  sending: boolean;
}

// ─── Hook Options & Result ───────────────────────────────────

export interface UseAgentChatOptions {
  agentId: string;
  model?: string;
  resumeSessionId?: string;
  excludeCodeTools?: boolean;
  onStateChange?: (state: ChatSidebarState) => void;
  onToolApprovalRequest?: (data: ToolApprovalData) => void;
  onTransactionRequest?: (data: TransactionSigningData) => void;
}

export interface UseAgentChatResult {
  messages: ChatMessage[];
  messagesLoading: boolean;
  sending: boolean;
  sessionId: string | null;
  streamingPhase: 'idle' | 'tools' | 'streaming';
  activeTools: string[];
  apiKeyConfigured: boolean | null;
  pendingApproval: ToolApprovalData | null;
  pendingTransaction: TransactionSigningData | null;
  totalCost: number;
  sendMessage: (text: string, options?: { images?: ChatImage[] }) => Promise<void>;
  clearChat: () => void;
  refreshApiKeyStatus: () => void;
  /** Create a session eagerly (without sending a message). Enables voice before first chat. */
  ensureSession: () => Promise<string>;
  /** Respond to a tool approval request. */
  approveToolUse: (approvalId: string, approved: boolean, approveForSession?: boolean) => Promise<void>;
  /** Respond to a transaction signing request. */
  submitTransaction: (approvalId: string, txHash?: string, rejected?: boolean) => Promise<void>;
}

/**
 * SSE streaming chat hook with thinking, planning, tool approval,
 * transaction signing, image support, and sidebar state callbacks.
 *
 * Port of marketplace AgentChat.tsx streaming handler into reusable SDK hook.
 */
export function useAgentChat({
  agentId,
  model = 'haiku',
  resumeSessionId,
  excludeCodeTools,
  onStateChange,
  onToolApprovalRequest,
  onTransactionRequest,
}: UseAgentChatOptions): UseAgentChatResult {
  const client = useRickyData();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(!!resumeSessionId);
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(resumeSessionId || null);
  const [streamingPhase, setStreamingPhase] = useState<'idle' | 'tools' | 'streaming'>('idle');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalData | null>(null);
  const [pendingTransaction, setPendingTransaction] = useState<TransactionSigningData | null>(null);
  const [totalCost, setTotalCost] = useState(0);

  const modelRef = useRef(model);
  modelRef.current = model;
  const messageQueueRef = useRef<string[]>([]);

  // Keep callback refs stable to avoid re-renders
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onToolApprovalRef = useRef(onToolApprovalRequest);
  onToolApprovalRef.current = onToolApprovalRequest;
  const onTransactionRef = useRef(onTransactionRequest);
  onTransactionRef.current = onTransactionRequest;

  // ─── State change emission ─────────────────────────────────

  const emitStateChange = useCallback((overrides?: Partial<ChatSidebarState>) => {
    // Read from refs/state at call time — caller can pass overrides for values
    // that haven't settled into state yet (e.g. during the same tick).
    onStateChangeRef.current?.({
      selectedModel: modelRef.current,
      sessionId,
      messageCount: messages.length,
      totalCost,
      streamingPhase,
      activeTools,
      sending,
      ...overrides,
    });
  }, [sessionId, messages.length, totalCost, streamingPhase, activeTools, sending]);

  // Emit state change whenever key values change
  useEffect(() => {
    emitStateChange();
  }, [emitStateChange]);

  // ─── API key check ─────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    client.getApiKeyStatus()
      .then(({ configured }) => { if (!cancelled) setApiKeyConfigured(configured); })
      .catch(() => { if (!cancelled) setApiKeyConfigured(false); });
    return () => { cancelled = true; };
  }, [client]);

  // ─── Resume session ────────────────────────────────────────

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

  // ─── Send message ──────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, options?: { images?: ChatImage[] }) => {
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
      images: options?.images,
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

      // Convert ChatImage[] to ImageAttachment[] for the API
      const apiImages: ImageAttachment[] | undefined = options?.images?.length
        ? options.images.map(img => ({ data: img.data, mediaType: img.mediaType as ImageAttachment['mediaType'] }))
        : undefined;

      const response = await client.chatRaw(agentId, sid, text.trim(), modelRef.current, apiImages);

      let textAccum = '';
      let thinkingAccum = '';
      const toolExecutions: ToolExecution[] = [];
      let messageCost = '';
      let toolIdCounter = 0;

      const streamingMsgId = `agent-streaming-${Date.now()}`;

      // Reset streaming state
      setActiveTools([]);
      setStreamingPhase('idle');

      // Helper: update or create the streaming message efficiently.
      // Uses the marketplace's optimized flushStreamingMsg pattern:
      // streamingMsgCreated flag + findIndex + splice instead of prev.map()
      let streamingMsgCreated = false;
      const flushStreamingMsg = () => {
        const snapshot: ChatMessage = {
          id: streamingMsgId,
          role: 'agent' as const,
          content: textAccum,
          thinking: thinkingAccum || undefined,
          toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined,
          timestamp: new Date().toISOString(),
        };
        if (!streamingMsgCreated) {
          streamingMsgCreated = true;
          setMessages(prev => [...prev, snapshot]);
        } else {
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === streamingMsgId);
            if (idx === -1) return [...prev, snapshot];
            const next = [...prev];
            next[idx] = snapshot;
            return next;
          });
        }
      };

      await streamSSEEvents(response, (event: SSEEvent) => {
        switch (event.type) {
          case 'text':
            setStreamingPhase('streaming');
            setActiveTools([]);
            textAccum += event.data;
            flushStreamingMsg();
            break;

          case 'thinking':
            // Thinking text stored separately for collapsible display
            thinkingAccum += (typeof event.data === 'string' ? event.data : (event.data as { thinking?: string }).thinking || '');
            flushStreamingMsg();
            break;

          case 'planning':
            // Planning text shows agent reasoning before tool use
            textAccum += (typeof event.data === 'string' ? event.data : '');
            setStreamingPhase('streaming');
            flushStreamingMsg();
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
            flushStreamingMsg();
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
            flushStreamingMsg();
            break;
          }

          case 'done':
            if (event.data.cost) messageCost = event.data.cost as string;
            break;

          case 'error':
            textAccum += `\n\nError: ${event.data.message}`;
            flushStreamingMsg();
            break;

          case 'tool_approval_request': {
            const approvalData = event.data as ToolApprovalData;
            setPendingApproval(approvalData);
            onToolApprovalRef.current?.(approvalData);
            break;
          }

          case 'transaction_signing_request': {
            const txData = event.data as TransactionSigningData;
            setPendingTransaction(txData);
            onTransactionRef.current?.(txData);
            break;
          }
        }
      });

      // Finalize — replace streaming message with permanent one
      setMessages(prev => {
        const withoutStreaming = prev.filter(m => m.id !== streamingMsgId);
        return [...withoutStreaming, {
          id: `msg-${Date.now()}-agent`,
          role: 'agent' as const,
          content: textAccum || (toolExecutions.length > 0 ? '' : '(No response)'),
          thinking: thinkingAccum || undefined,
          toolExecutions: toolExecutions.length > 0 ? [...toolExecutions] : undefined,
          timestamp: new Date().toISOString(),
          costUSD: messageCost || undefined,
        }];
      });

      // Track cost
      if (messageCost) {
        const costNum = parseFloat(messageCost.replace('$', ''));
        if (!isNaN(costNum)) setTotalCost(prev => prev + costNum);
      }

    } catch (err: unknown) {
      const addError = (content: string) => {
        setMessages(prev => [...prev, {
          id: `msg-${Date.now()}-error`, role: 'agent' as const,
          content,
          timestamp: new Date().toISOString(),
        }]);
      };

      if (err instanceof AgentError) {
        switch (err.code) {
          case AgentErrorCode.RATE_LIMITED:
            addError('Insufficient balance. Please deposit funds to continue.');
            break;
          case AgentErrorCode.NOT_FOUND:
            setSessionId(null);
            addError('Session expired. Starting a new conversation...');
            break;
          case AgentErrorCode.AUTH_EXPIRED:
          case AgentErrorCode.AUTH_REQUIRED:
            setSessionId(null);
            addError('Re-authenticating... please send again.');
            break;
          case AgentErrorCode.VALIDATION_ERROR:
            if (/anthropic api key|required/i.test(err.message)) {
              setApiKeyConfigured(false);
            }
            addError(err.message);
            break;
          default:
            addError(`Error: ${err.message}`);
        }
      } else {
        const errMessage = err instanceof Error ? err.message : String(err);
        addError(`Error: ${errMessage}`);
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
  }, [client, agentId, sessionId, apiKeyConfigured, sending]);

  // ─── Tool approval / transaction signing ───────────────────

  const approveToolUse = useCallback(async (approvalId: string, approved: boolean, _approveForSession?: boolean) => {
    setPendingApproval(null);
    const token = await (client as any).ensureAuthenticated?.() ?? undefined;
    await fetch(
      `${(client as any).gatewayUrl || 'https://agents.rickydata.org'}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId || '')}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ approvalId, approved }),
      },
    );
  }, [client, agentId, sessionId]);

  const submitTransaction = useCallback(async (approvalId: string, txHash?: string, rejected?: boolean) => {
    setPendingTransaction(null);
    const token = await (client as any).ensureAuthenticated?.() ?? undefined;
    await fetch(
      `${(client as any).gatewayUrl || 'https://agents.rickydata.org'}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId || '')}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ approvalId, approved: !rejected, txHash }),
      },
    );
  }, [client, agentId, sessionId]);

  // ─── Refresh API key status ────────────────────────────────

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

  // ─── Clear / Ensure Session ────────────────────────────────

  const clearChat = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    setStreamingPhase('idle');
    setActiveTools([]);
    setTotalCost(0);
    setPendingApproval(null);
    setPendingTransaction(null);
  }, []);

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
    pendingApproval,
    pendingTransaction,
    totalCost,
    sendMessage,
    clearChat,
    refreshApiKeyStatus,
    ensureSession,
    approveToolUse,
    submitTransaction,
  };
}
