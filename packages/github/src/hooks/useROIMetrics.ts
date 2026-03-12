import { useQuery } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import { feedbackKeys } from './useFeedbackOutcomes.js';

export function useROIMetrics() {
  const { feedback } = useGitHubClients();

  const summary = useQuery({
    queryKey: feedbackKeys.summary(),
    queryFn: () => feedback.getSummary(),
    staleTime: 120_000,
  });

  const accuracy = useQuery({
    queryKey: feedbackKeys.accuracy(),
    queryFn: () => feedback.getAccuracy(),
    staleTime: 120_000,
  });

  const driftAlerts = useQuery({
    queryKey: feedbackKeys.driftAlerts(),
    queryFn: () => feedback.getDriftAlerts(),
    staleTime: 60_000,
  });

  return { summary, accuracy, driftAlerts };
}
