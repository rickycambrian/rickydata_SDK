import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { WalletSettings } from 'rickydata/agent';
import { useRickyData, useRickyDataWalletTransport } from '../providers/RickyDataProvider.js';

export const walletSettingsKeys = {
  all: ['wallet-settings'] as const,
  settings: () => [...walletSettingsKeys.all, 'current'] as const,
};

/** Fetch wallet settings. */
export function useWalletSettings() {
  const client = useRickyData();
  const walletTransport = useRickyDataWalletTransport();
  const queryClient = useQueryClient();

  const query = useQuery<WalletSettings>({
    queryKey: walletSettingsKeys.settings(),
    queryFn: () => walletTransport?.getWalletSettings
      ? walletTransport.getWalletSettings()
      : client.getWalletSettings(),
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (settings: Partial<WalletSettings>) => walletTransport?.updateWalletSettings
      ? walletTransport.updateWalletSettings(settings)
      : client.updateWalletSettings(settings),
    onSuccess: (data) => {
      queryClient.setQueryData(walletSettingsKeys.settings(), data);
    },
  });

  return {
    ...query,
    settings: query.data,
    updateSettings: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
}
