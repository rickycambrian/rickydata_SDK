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
});
