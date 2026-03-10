import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionListEntry, SessionDetail } from 'rickydata/agent';
import { useRickyData } from '../providers/RickyDataProvider.js';

export const sessionKeys = {
  all: ['sessions'] as const,
  lists: (agentId: string) => [...sessionKeys.all, 'list', agentId] as const,
  details: () => [...sessionKeys.all, 'detail'] as const,
  detail: (agentId: string, sessionId: string) =>
    [...sessionKeys.details(), agentId, sessionId] as const,
};

/** List sessions for an agent. */
export function useSessions(agentId: string | undefined) {
  const client = useRickyData();
  return useQuery<SessionListEntry[]>({
    queryKey: sessionKeys.lists(agentId!),
    queryFn: () => client.listSessions(agentId!),
    enabled: !!agentId,
    staleTime: 30_000,
  });
}

/** Get session detail including messages. */
export function useSession(agentId: string | undefined, sessionId: string | undefined) {
  const client = useRickyData();
  return useQuery<SessionDetail>({
    queryKey: sessionKeys.detail(agentId!, sessionId!),
    queryFn: () => client.getSession(agentId!, sessionId!),
    enabled: !!agentId && !!sessionId,
  });
}

/** Mutation to delete a session. */
export function useDeleteSession() {
  const client = useRickyData();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, sessionId }: { agentId: string; sessionId: string }) =>
      client.deleteSession(agentId, sessionId),
    onSuccess: (_data, { agentId }) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.lists(agentId) });
    },
  });
}
