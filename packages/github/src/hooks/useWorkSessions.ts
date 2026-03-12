import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import { issueKeys } from './useGitHubIssues.js';

export function useStartSession() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) => github.startSession(issueId),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.all }),
  });
}

export function useCreatePR() {
  const { github } = useGitHubClients();
  return useMutation({
    mutationFn: (sessionId: string) => github.createPR(sessionId),
  });
}
