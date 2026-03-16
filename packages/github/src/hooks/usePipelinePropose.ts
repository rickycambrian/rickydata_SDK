import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { PipelineProposeRequest } from '../types.js';
import { issueKeys } from './useGitHubIssues.js';

export function usePipelinePropose() {
  const { pipeline } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PipelineProposeRequest) => pipeline.propose(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.all });
    },
  });
}
