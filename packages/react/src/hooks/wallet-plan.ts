import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WalletSettings, WalletPlan } from 'rickydata/agent';
import { useRickyData, useRickyDataWalletTransport } from '../providers/RickyDataProvider.js';
import { useWalletSettings, walletSettingsKeys } from './wallet-settings.js';

function defaultModelForPlanProvider(provider: WalletSettings['modelProvider'] | undefined): string {
  if (provider === 'openrouter') return 'google/gemma-4-26b-a4b-it';
  if (provider === 'zai') return 'glm-5.1';
  if (provider === 'deepseek') return 'deepseek-v4-pro';
  if (provider === 'gemini') return 'gemini-2.5-pro';
  return 'MiniMax-M2.7';
}

export function useWalletPlan() {
  const client = useRickyData();
  const walletTransport = useRickyDataWalletTransport();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useWalletSettings();

  // Infer plan: explicit or default to free (matching gateway default)
  const plan: WalletPlan = (settings?.plan as WalletPlan) ?? 'free';
  const isFreePlan = plan === 'free';

  const switchPlanMutation = useMutation({
    mutationFn: async (newPlan: WalletPlan) => {
      const updates: Partial<WalletSettings> = { plan: newPlan };
      if (newPlan === 'free') {
        const provider = (
          settings?.modelProvider === 'openrouter' ||
          settings?.modelProvider === 'zai' ||
          settings?.modelProvider === 'deepseek'
        )
          ? settings.modelProvider
          : 'minimax';
        updates.modelProvider = provider;
        updates.defaultModel = defaultModelForPlanProvider(provider);
      }
      return walletTransport?.updateWalletSettings
        ? walletTransport.updateWalletSettings(updates)
        : client.updateWalletSettings(updates);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(walletSettingsKeys.settings(), data);
    },
  });

  return {
    plan,
    isFreePlan,
    isLoading,
    modelProvider: settings?.modelProvider ?? (isFreePlan ? 'minimax' : 'anthropic'),
    switchPlan: switchPlanMutation.mutateAsync,
    isSwitching: switchPlanMutation.isPending,
    settings,
  };
}
