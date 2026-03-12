import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import { feedbackKeys } from './useFeedbackOutcomes.js';

export function useReportOutcome() {
  const { feedback } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { executionId: string; status: string; quality?: number }) =>
      feedback.reportOutcome(args.executionId, { status: args.status, quality: args.quality }),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedbackKeys.all }),
  });
}
