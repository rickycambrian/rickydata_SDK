import { useQuery } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';

export const pipelineKeys = {
  all: ['pipeline'] as const,
  status: () => [...pipelineKeys.all, 'status'] as const,
};

export function usePipelineStatus(opts?: { refetchInterval?: number }) {
  const { pipeline } = useGitHubClients();
  return useQuery({
    queryKey: pipelineKeys.status(),
    queryFn: () => pipeline.getStatus(),
    refetchInterval: opts?.refetchInterval ?? 30_000,
  });
}
