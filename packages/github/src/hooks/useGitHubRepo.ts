import { useQuery } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';

export const repoKeys = {
  all: ['github-repos'] as const,
  detail: (owner: string, repo: string) => [...repoKeys.all, owner, repo] as const,
};

export function useGitHubRepo(owner: string, repo: string) {
  const { github } = useGitHubClients();
  return useQuery({
    queryKey: repoKeys.detail(owner, repo),
    queryFn: () => github.listIssues(owner, repo, { pageSize: 0 }),
    enabled: !!owner && !!repo,
  });
}
