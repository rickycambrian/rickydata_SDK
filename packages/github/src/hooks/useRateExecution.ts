import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { RateRequest } from '../types.js';
import { feedbackKeys } from './useFeedbackOutcomes.js';

export function useRateExecution() {
  const { feedback } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { executionId: string } & RateRequest) => {
      const { executionId, ...rating } = args;
      return feedback.rateExecution(executionId, rating);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKeys.all }),
  });
}
