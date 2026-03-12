import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { GitHubApi } from './services/github-api.js';
import { PipelineApi } from './services/pipeline-api.js';
import { FeedbackApi } from './services/feedback-api.js';

export interface GitHubClients {
  github: GitHubApi;
  pipeline: PipelineApi;
  feedback: FeedbackApi;
}

const GitHubContext = createContext<GitHubClients | null>(null);

export interface GitHubProviderProps {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  children: ReactNode;
}

export function GitHubProvider({ baseUrl, getToken, children }: GitHubProviderProps) {
  const clients = useMemo(() => ({
    github: new GitHubApi({ baseUrl, getToken }),
    pipeline: new PipelineApi({ baseUrl, getToken }),
    feedback: new FeedbackApi({ baseUrl, getToken }),
  }), [baseUrl, getToken]);

  return (
    <GitHubContext.Provider value={clients}>
      {children}
    </GitHubContext.Provider>
  );
}

export function useGitHubClients(): GitHubClients {
  const ctx = useContext(GitHubContext);
  if (!ctx) throw new Error('useGitHubClients must be used within a <GitHubProvider>');
  return ctx;
}
