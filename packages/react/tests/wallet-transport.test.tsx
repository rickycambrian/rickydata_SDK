import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  RickyDataProvider,
  useFreeTierStatus,
  useWalletBalance,
  useWalletPlan,
  useWalletSettings,
  type RickyDataWalletTransport,
} from '../src/index.js';

function renderWalletHook<TResult>(hook: () => TResult, walletTransport: RickyDataWalletTransport) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const mockClient = {
    getWalletSettings: vi.fn().mockRejectedValue(new Error('client fallback should not be used')),
    updateWalletSettings: vi.fn().mockRejectedValue(new Error('client fallback should not be used')),
    getWalletBalance: vi.fn().mockRejectedValue(new Error('client fallback should not be used')),
    getFreeTierStatus: vi.fn().mockRejectedValue(new Error('client fallback should not be used')),
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(
      RickyDataProvider,
      {
        client: mockClient as any,
        config: {
          getAuthToken: async () => 'test-token',
          walletTransport,
        },
      },
      children,
    ),
  );

  return renderHook(hook, { wrapper });
}

describe('wallet transport overrides', () => {
  it('uses wallet transport for settings reads and writes', async () => {
    const transport = {
      getWalletSettings: vi.fn().mockResolvedValue({
        plan: 'free',
        modelProvider: 'minimax',
        defaultModel: 'MiniMax-M2.7',
      }),
      updateWalletSettings: vi.fn().mockImplementation(async (settings) => ({
        plan: 'free',
        modelProvider: settings.modelProvider || 'minimax',
        defaultModel: settings.defaultModel || 'MiniMax-M2.7',
      })),
    } satisfies RickyDataWalletTransport;

    const { result } = renderWalletHook(() => useWalletSettings(), transport);

    await waitFor(() => {
      expect(result.current.settings?.defaultModel).toBe('MiniMax-M2.7');
    });

    await result.current.updateSettings({
      modelProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    });

    expect(transport.getWalletSettings).toHaveBeenCalledTimes(1);
    expect(transport.updateWalletSettings).toHaveBeenCalledWith({
      modelProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('uses wallet transport for plan, balance, and free-tier reads', async () => {
    const transport = {
      getWalletSettings: vi.fn().mockResolvedValue({
        plan: 'free',
        modelProvider: 'minimax',
        defaultModel: 'MiniMax-M2.7',
      }),
      getWalletBalance: vi.fn().mockResolvedValue({
        availableBalance: '2500000',
        unifiedDepositAddress: '0xdeposit',
        agentSpends: {},
        depositInstructions: null,
      }),
      getFreeTierStatus: vi.fn().mockResolvedValue({
        dailyLimit: 10,
        dailyUsed: 2,
        dailyRemaining: 8,
        resetAt: '2026-04-15T00:00:00.000Z',
      }),
    } satisfies RickyDataWalletTransport;

    const settingsHook = renderWalletHook(() => useWalletPlan(), transport);
    const balanceHook = renderWalletHook(() => useWalletBalance(), transport);
    const freeTierHook = renderWalletHook(() => useFreeTierStatus(), transport);

    await waitFor(() => {
      expect(settingsHook.result.current.plan).toBe('free');
      expect(balanceHook.result.current.balanceDisplay).toBe('$2.50');
      expect(freeTierHook.result.current.status?.dailyRemaining).toBe(8);
    });

    expect(transport.getWalletSettings).toHaveBeenCalled();
    expect(transport.getWalletBalance).toHaveBeenCalled();
    expect(transport.getFreeTierStatus).toHaveBeenCalled();
  });
});
