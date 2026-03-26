import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { AgentError, AgentErrorCode } from 'rickydata/agent';
import { createMockClient, renderHookWithProvider } from './test-utils.js';
import { useAgentChat } from '../src/hooks/chat.js';

// Mock streamSSEEvents to control SSE event delivery
vi.mock('rickydata/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('rickydata/agent')>();
  return {
    ...actual,
    streamSSEEvents: vi.fn(),
  };
});

import { streamSSEEvents } from 'rickydata/agent';
const mockStreamSSE = vi.mocked(streamSSEEvents);

function setupSSEMock(events: Array<{ type: string; data: unknown }>) {
  mockStreamSSE.mockImplementation(async (_response, onEvent) => {
    for (const event of events) {
      onEvent(event as any);
    }
  });
}

describe('useAgentChat', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    // Default: API key configured, SSE returns a simple text response
    setupSSEMock([
      { type: 'text', data: 'Hello from agent' },
      { type: 'done', data: { cost: '$0.01' } },
    ]);
  });

  it('sends message and receives SSE text', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockClient.createSession).toHaveBeenCalledWith('agent-1', 'haiku');
    expect(mockClient.chatRaw).toHaveBeenCalled();
    // Should have user message + agent response
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('Hello');
    expect(result.current.messages[1].role).toBe('agent');
    expect(result.current.messages[1].content).toBe('Hello from agent');
    expect(result.current.messages[1].costUSD).toBe('$0.01');
  });

  it('handles 402 balance error', async () => {
    mockClient.chatRaw.mockRejectedValue(
      new AgentError(AgentErrorCode.RATE_LIMITED, 'Insufficient balance', { statusCode: 402 }),
    );

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    const errorMsg = result.current.messages.find(m => m.content.includes('Insufficient balance'));
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.role).toBe('agent');
  });

  it('handles 401 auth error', async () => {
    mockClient.chatRaw.mockRejectedValue(
      new AgentError(AgentErrorCode.AUTH_EXPIRED, 'Authentication expired', { statusCode: 401 }),
    );

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.sessionId).toBeNull();
    const errorMsg = result.current.messages.find(m => m.content.includes('Re-authenticating'));
    expect(errorMsg).toBeDefined();
  });

  it('handles 404 session expired', async () => {
    mockClient.chatRaw.mockRejectedValue(
      new AgentError(AgentErrorCode.NOT_FOUND, 'Session not found', { statusCode: 404 }),
    );

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.sessionId).toBeNull();
    const errorMsg = result.current.messages.find(m => m.content.includes('Session expired'));
    expect(errorMsg).toBeDefined();
  });

  it('handles validation error with API key message', async () => {
    mockClient.chatRaw.mockRejectedValue(
      new AgentError(AgentErrorCode.VALIDATION_ERROR, 'Anthropic API key required', { statusCode: 400 }),
    );

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.apiKeyConfigured).toBe(false);
  });

  it('blocks when API key not configured', async () => {
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: false });

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    // Wait for API key status check to settle
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockClient.chatRaw).not.toHaveBeenCalled();
    const errorMsg = result.current.messages.find(m => m.content.includes('API key required'));
    expect(errorMsg).toBeDefined();
  });

  it('handles tool_call + tool_result SSE events', async () => {
    setupSSEMock([
      { type: 'tool_call', data: { name: 'server__tool_name', displayName: 'tool_name', args: { q: 'test' }, id: 'tc-1' } },
      { type: 'tool_result', data: { id: 'tc-1', name: 'server__tool_name', result: 'result data', isError: false } },
      { type: 'text', data: 'Based on the tool result...' },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Use a tool');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg).toBeDefined();
    expect(agentMsg!.toolExecutions).toHaveLength(1);
    expect(agentMsg!.toolExecutions![0].name).toBe('server__tool_name');
    expect(agentMsg!.toolExecutions![0].displayName).toBe('tool_name');
    expect(agentMsg!.toolExecutions![0].result).toEqual({ content: 'result data', isError: false });
  });

  it('clearChat resets state', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    // Send a message first
    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.sessionId).toBe('session-1');

    // Clear
    act(() => {
      result.current.clearChat();
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sessionId).toBeNull();
  });

  it('ensureSession creates eagerly', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    let sessionId: string | undefined;
    await act(async () => {
      sessionId = await result.current.ensureSession();
    });

    expect(mockClient.createSession).toHaveBeenCalledWith('agent-1', 'haiku');
    expect(sessionId).toBe('session-1');
    expect(result.current.sessionId).toBe('session-1');
  });

  it('resume session loads messages', async () => {
    mockClient.getSession.mockResolvedValue({
      id: 'old-session',
      agentId: 'agent-1',
      model: 'haiku',
      messages: [
        { role: 'user', content: 'Previous question', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Previous answer', timestamp: '2024-01-01T00:00:01Z' },
      ],
      createdAt: '2024-01-01T00:00:00Z',
    });

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1', resumeSessionId: 'old-session' }),
      mockClient,
    );

    // Wait for session load
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(mockClient.getSession).toHaveBeenCalledWith('agent-1', 'old-session');
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe('Previous question');
    expect(result.current.messages[1].content).toBe('Previous answer');
    expect(result.current.messagesLoading).toBe(false);
  });

  it('handles non-AgentError exceptions', async () => {
    mockClient.chatRaw.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    const errorMsg = result.current.messages.find(m => m.content.includes('Network failure'));
    expect(errorMsg).toBeDefined();
  });

  // ─── Enriched Hook Tests (Phase 2b) ──────────────────────

  it('handles thinking SSE events', async () => {
    setupSSEMock([
      { type: 'thinking', data: 'Let me consider this carefully...' },
      { type: 'text', data: 'Here is my answer.' },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Think about this');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg).toBeDefined();
    expect(agentMsg!.thinking).toBe('Let me consider this carefully...');
    expect(agentMsg!.content).toBe('Here is my answer.');
  });

  it('handles thinking events with object data', async () => {
    setupSSEMock([
      { type: 'thinking', data: { thinking: 'Deep thought from object' } },
      { type: 'text', data: 'Result.' },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Think');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.thinking).toBe('Deep thought from object');
  });

  it('handles planning SSE events (appended to content)', async () => {
    setupSSEMock([
      { type: 'planning', data: 'I will search for information first. ' },
      { type: 'text', data: 'Here are the results.' },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Plan something');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.content).toBe('I will search for information first. Here are the results.');
  });

  it('handles error SSE events inline', async () => {
    setupSSEMock([
      { type: 'text', data: 'Partial response' },
      { type: 'error', data: { message: 'Tool execution failed' } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Do something');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.content).toContain('Partial response');
    expect(agentMsg!.content).toContain('Error: Tool execution failed');
  });

  it('tracks totalCost across multiple messages', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    // First message with cost $0.01
    setupSSEMock([
      { type: 'text', data: 'Response 1' },
      { type: 'done', data: { cost: '$0.01' } },
    ]);

    await act(async () => {
      await result.current.sendMessage('Message 1');
    });

    expect(result.current.totalCost).toBeCloseTo(0.01);

    // Second message with cost $0.05
    setupSSEMock([
      { type: 'text', data: 'Response 2' },
      { type: 'done', data: { cost: '$0.05' } },
    ]);

    await act(async () => {
      await result.current.sendMessage('Message 2');
    });

    expect(result.current.totalCost).toBeCloseTo(0.06);
  });

  it('calls onStateChange callback with sidebar state', async () => {
    const onStateChange = vi.fn();

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1', onStateChange }),
      mockClient,
    );

    // Wait for initial render + API key check
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should have been called at least once with initial state
    expect(onStateChange).toHaveBeenCalled();
    const lastCall = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({
      selectedModel: 'haiku',
      sessionId: null,
      messageCount: 0,
      streamingPhase: 'idle',
    });

    // Send a message — state should update
    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    const afterSend = onStateChange.mock.calls[onStateChange.mock.calls.length - 1][0];
    expect(afterSend.messageCount).toBe(2);
    expect(afterSend.sessionId).toBe('session-1');
  });

  it('sends images with message', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    const testImages = [
      { data: 'base64data', mediaType: 'image/png', preview: 'blob:preview' },
    ];

    await act(async () => {
      await result.current.sendMessage('Look at this', { images: testImages });
    });

    // User message should have images attached
    const userMsg = result.current.messages.find(m => m.role === 'user');
    expect(userMsg!.images).toHaveLength(1);
    expect(userMsg!.images![0].data).toBe('base64data');

    // chatRaw should have been called with image attachments
    expect(mockClient.chatRaw).toHaveBeenCalledWith(
      'agent-1',
      'session-1',
      'Look at this',
      'haiku',
      [{ data: 'base64data', mediaType: 'image/png' }],
    );
  });

  it('fires onToolApprovalRequest and sets pendingApproval', async () => {
    const onToolApprovalRequest = vi.fn();

    setupSSEMock([
      { type: 'tool_approval_request', data: { approvalId: 'ap-1', toolName: 'dangerous_tool', args: { x: 1 }, description: 'Run dangerous operation' } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1', onToolApprovalRequest }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Do dangerous thing');
    });

    expect(onToolApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'ap-1', toolName: 'dangerous_tool' }),
    );
    expect(result.current.pendingApproval).toMatchObject({
      approvalId: 'ap-1',
      toolName: 'dangerous_tool',
    });
  });

  it('fires onTransactionRequest and sets pendingTransaction', async () => {
    const onTransactionRequest = vi.fn();

    setupSSEMock([
      { type: 'transaction_signing_request', data: { approvalId: 'tx-1', description: 'Sign transaction', toolName: 'geo_publish', timeoutMs: 60000 } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1', onTransactionRequest }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Publish to Geo');
    });

    expect(onTransactionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'tx-1', toolName: 'geo_publish' }),
    );
    expect(result.current.pendingTransaction).toMatchObject({
      approvalId: 'tx-1',
      description: 'Sign transaction',
    });
  });

  it('approveToolUse clears pendingApproval and posts to gateway', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    setupSSEMock([
      { type: 'tool_approval_request', data: { approvalId: 'ap-1', toolName: 'tool', args: {} } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Approve me');
    });

    expect(result.current.pendingApproval).not.toBeNull();

    await act(async () => {
      await result.current.approveToolUse('ap-1', true);
    });

    expect(result.current.pendingApproval).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/approve'),
      expect.objectContaining({ method: 'POST' }),
    );

    fetchSpy.mockRestore();
  });

  it('submitTransaction clears pendingTransaction', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    setupSSEMock([
      { type: 'transaction_signing_request', data: { approvalId: 'tx-1', description: 'Sign', toolName: 'geo', timeoutMs: 60000 } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Sign');
    });

    expect(result.current.pendingTransaction).not.toBeNull();

    await act(async () => {
      await result.current.submitTransaction('tx-1', '0xhash123');
    });

    expect(result.current.pendingTransaction).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/approve'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('0xhash123'),
      }),
    );

    fetchSpy.mockRestore();
  });

  it('tool_result matches by name fallback when id is missing', async () => {
    setupSSEMock([
      { type: 'tool_call', data: { name: 'server__search', displayName: 'search', args: { q: 'test' }, id: 'tc-1' } },
      { type: 'tool_result', data: { name: 'server__search', result: 'found it', isError: false } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Search');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.toolExecutions![0].result).toEqual({ content: 'found it', isError: false });
  });

  it('tool_result uses content field as fallback', async () => {
    setupSSEMock([
      { type: 'tool_call', data: { name: 'srv__read', args: {}, id: 'tc-1' } },
      { type: 'tool_result', data: { id: 'tc-1', name: 'srv__read', content: 'content fallback', isError: false } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Read');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.toolExecutions![0].result!.content).toBe('content fallback');
  });

  it('clearChat resets totalCost and pendingApproval', async () => {
    setupSSEMock([
      { type: 'tool_approval_request', data: { approvalId: 'ap-1', toolName: 'tool', args: {} } },
      { type: 'text', data: 'Done' },
      { type: 'done', data: { cost: '$0.10' } },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(result.current.totalCost).toBeGreaterThan(0);
    expect(result.current.pendingApproval).not.toBeNull();

    act(() => {
      result.current.clearChat();
    });

    expect(result.current.totalCost).toBe(0);
    expect(result.current.pendingApproval).toBeNull();
    expect(result.current.pendingTransaction).toBeNull();
  });

  it('skips empty messages', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(mockClient.chatRaw).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(0);
  });

  it('uses custom model parameter', async () => {
    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1', model: 'sonnet' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockClient.createSession).toHaveBeenCalledWith('agent-1', 'sonnet');
  });

  it('refreshApiKeyStatus updates apiKeyConfigured state', async () => {
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: false });

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    // Wait for initial API key check
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(result.current.apiKeyConfigured).toBe(false);

    // Simulate API key being configured
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: true });

    await act(async () => {
      result.current.refreshApiKeyStatus();
      await new Promise(r => setTimeout(r, 10));
    });

    expect(result.current.apiKeyConfigured).toBe(true);
    // Should show success message after transition from false -> true
    const successMsg = result.current.messages.find(m => m.content.includes('API key configured successfully'));
    expect(successMsg).toBeDefined();
  });

  it('tool-only response without text shows empty content', async () => {
    setupSSEMock([
      { type: 'tool_call', data: { name: 'srv__action', displayName: 'action', args: {}, id: 'tc-1' } },
      { type: 'tool_result', data: { id: 'tc-1', name: 'srv__action', result: 'done', isError: false } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Just do it');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg).toBeDefined();
    expect(agentMsg!.content).toBe('');
    expect(agentMsg!.toolExecutions).toHaveLength(1);
  });

  it('auto-generates displayName from tool name when not provided', async () => {
    setupSSEMock([
      { type: 'tool_call', data: { name: 'server__my_tool', args: {}, id: 'tc-1' } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Use tool');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.toolExecutions![0].displayName).toBe('my_tool');
  });

  it('auto-generates tool id when not provided', async () => {
    setupSSEMock([
      { type: 'tool_call', data: { name: 'srv__tool_a', args: {} } },
      { type: 'tool_call', data: { name: 'srv__tool_b', args: {} } },
      { type: 'done', data: {} },
    ]);

    const { result } = renderHookWithProvider(
      () => useAgentChat({ agentId: 'agent-1' }),
      mockClient,
    );

    await act(async () => {
      await result.current.sendMessage('Use tools');
    });

    const agentMsg = result.current.messages.find(m => m.role === 'agent');
    expect(agentMsg!.toolExecutions).toHaveLength(2);
    // IDs should be auto-generated and different
    expect(agentMsg!.toolExecutions![0].id).toMatch(/^tool-/);
    expect(agentMsg!.toolExecutions![1].id).toMatch(/^tool-/);
    expect(agentMsg!.toolExecutions![0].id).not.toBe(agentMsg!.toolExecutions![1].id);
  });
});
