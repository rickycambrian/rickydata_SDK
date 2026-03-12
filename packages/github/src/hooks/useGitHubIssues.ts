import { useQuery } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { ListOptions } from '../types.js';

export const issueKeys = {
  all: ['github-issues'] as const,
  list: (owner: string, repo: string, opts?: Record<string, unknown>) =>
    [...issueKeys.all, 'list', owner, repo, opts] as const,
};

export interface UseGitHubIssuesOptions extends ListOptions {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  enabled?: boolean;
}

export function useGitHubIssues(opts: UseGitHubIssuesOptions) {
  const { github } = useGitHubClients();
  const { owner, repo, enabled, ...listOpts } = opts;
  return useQuery({
    queryKey: issueKeys.list(owner, repo, listOpts),
    queryFn: () => github.listIssues(owner, repo, listOpts),
    enabled: enabled !== false && !!owner && !!repo,
  });
}
