import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WalletSettings, WalletPlan } from 'rickydata/agent';
import { useRickyData, useRickyDataWalletTransport } from '../providers/RickyDataProvider.js';
import { useWalletSettings, walletSettingsKeys } from './wallet-settings.js';

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
        updates.modelProvider = 'minimax';
        updates.defaultModel = 'MiniMax-M2.7';
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
