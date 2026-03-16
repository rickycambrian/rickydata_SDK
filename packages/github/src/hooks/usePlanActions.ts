import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import { pipelineKeys } from './usePipelineStatus.js';

export const planKeys = {
  all: ['plans'] as const,
};

export function useApprovePlan() {
  const { pipeline } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, model, budget }: { runId: string; model?: string; budget?: number }) =>
      pipeline.approvePlan(runId, { model, budget }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: planKeys.all });
      qc.invalidateQueries({ queryKey: pipelineKeys.all });
    },
  });
}

export function useRejectPlan() {
  const { pipeline } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => pipeline.rejectPlan(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}

export function useAddPlanFeedback() {
  const { pipeline } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, feedback }: { runId: string; feedback: string }) =>
      pipeline.addPlanFeedback(runId, feedback),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: planKeys.all });
    },
  });
}
