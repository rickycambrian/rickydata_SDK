import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRickyData } from '../providers/RickyDataProvider.js';

export const apiKeyKeys = {
  all: ['apikey'] as const,
  status: () => [...apiKeyKeys.all, 'status'] as const,
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
