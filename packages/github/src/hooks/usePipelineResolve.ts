import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { PipelineResolveRequest } from '../types.js';
import { issueKeys } from './useGitHubIssues.js';
import { feedbackKeys } from './useFeedbackOutcomes.js';

export function usePipelineResolve() {
  const { pipeline } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: PipelineResolveRequest) => pipeline.resolve(req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.all });
      qc.invalidateQueries({ queryKey: feedbackKeys.all });
    },
  });
}
