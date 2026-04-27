import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MarketplaceProvider } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';

export const apiKeyKeys = {
  all: ['apikey'] as const,
  status: () => [...apiKeyKeys.all, 'status'] as const,
  providerStatus: (provider: MarketplaceProvider) => [...apiKeyKeys.all, 'provider', provider, 'status'] as const,
};

/** Check if Anthropic API key is configured. */
export function useApiKeyStatus(opts?: { enabled?: boolean }) {
  const client = useRickyData();
  return useQuery({
    queryKey: apiKeyKeys.status(),
    queryFn: () => client.getApiKeyStatus(),
    staleTime: 30_000,
    enabled: opts?.enabled !== false,
  });
}

/** Check if a provider API key is configured/unlocked for the active wallet. */
export function useProviderApiKeyStatus(provider: MarketplaceProvider, opts?: { enabled?: boolean }) {
  const client = useRickyData();
  return useQuery({
    queryKey: apiKeyKeys.providerStatus(provider),
    queryFn: () => client.getProviderApiKeyStatus(provider),
    staleTime: 30_000,
    enabled: opts?.enabled !== false,
  });
}

/** Mutation to set the Anthropic API key. Invalidates status on success. */
export function useSetApiKey() {
  const client = useRickyData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => client.setApiKey(apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.status() });
    },
  });
}

/** Mutation to set any supported provider API key. Uses sign-to-derive when the provider has a signer. */
export function useSetProviderApiKey(provider: MarketplaceProvider) {
  const client = useRickyData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) => client.setProviderApiKey(provider, apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.providerStatus(provider) });
      if (provider === 'anthropic') {
        queryClient.invalidateQueries({ queryKey: apiKeyKeys.status() });
      }
    },
  });
}

/** Unlock a configured sign-to-derive provider key for this gateway session. */
export function useUnlockProviderVault(provider?: MarketplaceProvider) {
  const client = useRickyData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.unlockProviderVault(provider ? [provider] : undefined),
    onSuccess: (result) => {
      for (const unlocked of result.unlockedProviders) {
        queryClient.invalidateQueries({ queryKey: apiKeyKeys.providerStatus(unlocked) });
      }
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.status() });
    },
  });
}

/** Mutation to delete the Anthropic API key. */
export function useDeleteApiKey() {
  const client = useRickyData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.deleteApiKey(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.status() });
    },
  });
}
