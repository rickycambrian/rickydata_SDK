import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type {
  CreateGitHubRepoSessionInput,
  DeriveGitHubRepoSessionChallengeInput,
  GitHubRepoSession,
  GitHubRepoSessionChallenge,
  GitHubRepoSessionChatRequest,
  GitHubRepoSessionTree,
  GitHubRepoSettings,
} from '../types.js';
import type { SSEEvent } from 'rickydata/agent';

export const repoSessionKeys = {
  all: ['github-repo-sessions'] as const,
  settings: (owner: string, repo: string) => [...repoSessionKeys.all, 'settings', owner, repo] as const,
  tree: (sessionId: string, path?: string, ref?: string) =>
    [...repoSessionKeys.all, 'tree', sessionId, path ?? '', ref ?? ''] as const,
};

export function useGitHubRepoSettings(owner: string, repo: string, options?: { enabled?: boolean }) {
  const { github } = useGitHubClients();
  return useQuery<GitHubRepoSettings>({
    queryKey: repoSessionKeys.settings(owner, repo),
    queryFn: () => github.getRepoSettings(owner, repo),
    enabled: (options?.enabled ?? true) && !!owner && !!repo,
  });
}

export function useUpdateGitHubRepoSettings(owner: string, repo: string) {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation<GitHubRepoSettings, Error, Partial<GitHubRepoSettings>>({
    mutationFn: (settings) => github.updateRepoSettings(owner, repo, settings),
    onSuccess: (settings) => {
      qc.setQueryData(repoSessionKeys.settings(owner, repo), settings);
    },
  });
}

export function useDeriveGitHubRepoSessionChallenge(owner: string, repo: string) {
  const { github } = useGitHubClients();
  return useMutation<GitHubRepoSessionChallenge, Error, DeriveGitHubRepoSessionChallengeInput | undefined>({
    mutationFn: (input) => github.deriveRepoSessionChallenge(owner, repo, input ?? {}),
  });
}

export function useCreateGitHubRepoSession(owner: string, repo: string) {
  const { github } = useGitHubClients();
  return useMutation<GitHubRepoSession, Error, CreateGitHubRepoSessionInput>({
    mutationFn: (input) => github.createRepoSession(owner, repo, input),
  });
}

export function useDeleteGitHubRepoSession() {
  const { github } = useGitHubClients();
  return useMutation<void, Error, string>({
    mutationFn: (sessionId) => github.deleteRepoSession(sessionId),
  });
}

export function useGitHubRepoSessionTree(
  sessionId: string,
  options?: { path?: string; ref?: string; enabled?: boolean },
) {
  const { github } = useGitHubClients();
  return useQuery<GitHubRepoSessionTree>({
    queryKey: repoSessionKeys.tree(sessionId, options?.path, options?.ref),
    queryFn: () => github.getRepoSessionTree(sessionId, { path: options?.path, ref: options?.ref }),
    enabled: (options?.enabled ?? true) && !!sessionId,
  });
}

export function useGitHubRepoSessionChat() {
  const { github } = useGitHubClients();
  return useMutation<void, Error, {
    sessionId: string;
    input: GitHubRepoSessionChatRequest;
    signal?: AbortSignal;
    onEvent?: (event: SSEEvent) => void;
  }>({
    mutationFn: async ({ sessionId, input, signal, onEvent }) => {
      for await (const event of github.streamRepoSessionChat(sessionId, input, { signal })) {
        onEvent?.(event);
      }
    },
  });
}
