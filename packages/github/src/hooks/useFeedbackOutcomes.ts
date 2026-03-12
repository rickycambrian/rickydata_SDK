import { useQuery } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';

export const feedbackKeys = {
  all: ['feedback'] as const,
  summary: () => [...feedbackKeys.all, 'summary'] as const,
  accuracy: () => [...feedbackKeys.all, 'accuracy'] as const,
  driftAlerts: () => [...feedbackKeys.all, 'drift-alerts'] as const,
  outcome: (id: string) => [...feedbackKeys.all, 'outcome', id] as const,
};

export function useFeedbackSummary() {
  const { feedback } = useGitHubClients();
  return useQuery({
    queryKey: feedbackKeys.summary(),
    queryFn: () => feedback.getSummary(),
  });
}

export function useFeedbackOutcome(executionId: string) {
  const { feedback } = useGitHubClients();
  return useQuery({
    queryKey: feedbackKeys.outcome(executionId),
    queryFn: () => feedback.getOutcome(executionId),
    enabled: !!executionId,
  });
}
