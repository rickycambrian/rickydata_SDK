import React from 'react';
import { renderHook, type RenderHookOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { RickyDataProvider } from '../src/providers/RickyDataProvider.js';

/**
 * Creates a mock AgentClient with vi.fn() stubs for all methods used by hooks.
 */
export function createMockClient() {
  return {
    // Chat
    createSession: vi.fn().mockResolvedValue({ id: 'session-1', agentId: 'agent-1', model: 'haiku', createdAt: new Date().toISOString() }),
    chatRaw: vi.fn().mockResolvedValue(new Response('', { status: 200 })),
    getSession: vi.fn().mockResolvedValue({ id: 'session-1', agentId: 'agent-1', model: 'haiku', messages: [], createdAt: new Date().toISOString() }),

    // API Key
    getApiKeyStatus: vi.fn().mockResolvedValue({ configured: true }),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),

    // Secrets
    getAgentSecretStatus: vi.fn().mockResolvedValue({ configuredSecrets: [], missingRequired: [], ready: true }),
    storeAgentSecrets: vi.fn().mockResolvedValue(undefined),
    getMcpRequirements: vi.fn().mockResolvedValue({ agentId: 'agent-1', servers: [], totalRequired: 0 }),
    storeMcpSecrets: vi.fn().mockResolvedValue(undefined),

    // Sessions
    listSessions: vi.fn().mockResolvedValue([]),
    deleteSession: vi.fn().mockResolvedValue(undefined),

    // Agents
    listAgents: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn().mockResolvedValue({ id: 'agent-1', name: 'test', title: 'Test', description: '', model: 'haiku', tools: [], skills: [] }),

    // Balance
    getBalance: vi.fn().mockResolvedValue({ availableBalance: '10.00', unifiedDepositAddress: '0x', agentSpends: {} }),
    getTransactions: vi.fn().mockResolvedValue({ transactions: [], total: 0 }),

    // Settings
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({}),
  };
}

/**
 * Wraps renderHook with RickyDataProvider (injecting mock client) + QueryClientProvider.
 */
export function renderHookWithProvider<TResult>(
  hook: () => TResult,
  mockClient?: ReturnType<typeof createMockClient>,
) {
  const client = mockClient ?? createMockClient();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        RickyDataProvider,
        { client: client as any },
        children,
      ),
    );

  return {
    ...renderHook(hook, { wrapper }),
    mockClient: client,
    queryClient,
  };
}
