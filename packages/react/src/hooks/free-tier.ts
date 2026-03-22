import { useQuery } from '@tanstack/react-query';
import type { FreeTierStatus } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';

export const freeTierKeys = {
  all: ['free-tier'] as const,
  status: () => [...freeTierKeys.all, 'status'] as const,
};

const POLL_INTERVAL = 60_000;

export interface UseFreeTierStatusOptions {
  enabled?: boolean;
}

export function useFreeTierStatus(opts?: UseFreeTierStatusOptions) {
  const client = useRickyData();
  const enabled = opts?.enabled !== false;

  const query = useQuery<FreeTierStatus>({
    queryKey: freeTierKeys.status(),
    queryFn: () => client.getFreeTierStatus(),
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? POLL_INTERVAL : false,
  });

  return {
    ...query,
    status: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : 'Failed to fetch') : null,
    refresh: () => query.refetch(),
  };
}
