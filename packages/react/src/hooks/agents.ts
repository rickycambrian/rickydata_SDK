import { useQuery } from '@tanstack/react-query';
import type { AgentInfo, AgentDetailResponse } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';

export const agentKeys = {
  all: ['agents'] as const,
  lists: () => [...agentKeys.all, 'list'] as const,
  details: () => [...agentKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

/** Fetch all published agents. */
export function useAgents() {
  const client = useRickyData();
  return useQuery<AgentInfo[]>({
    queryKey: agentKeys.lists(),
    queryFn: () => client.listAgents(),
    staleTime: 5 * 60 * 1000, // 5 min
  });
}

/** Fetch a single agent's detail (tools, skills). */
export function useAgent(agentId: string | undefined) {
  const client = useRickyData();
  return useQuery<AgentDetailResponse>({
    queryKey: agentKeys.detail(agentId!),
    queryFn: () => client.getAgent(agentId!),
    enabled: !!agentId,
  });
}
