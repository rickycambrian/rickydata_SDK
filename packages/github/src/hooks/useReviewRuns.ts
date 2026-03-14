import { useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { CreateReviewRunInput } from '../services/github-api.js';
import type { ReviewRun, ReviewRunEvent, VerificationStatus } from '../types.js';

export const reviewRunKeys = {
  all: ['review-runs'] as const,
  list: (filters?: { repo?: string; prNumber?: number; status?: ReviewRun['status'] }) =>
    [...reviewRunKeys.all, 'list', filters ?? {}] as const,
  detail: (runId: string) => [...reviewRunKeys.all, 'detail', runId] as const,
  events: (runId: string) => [...reviewRunKeys.all, 'events', runId] as const,
};

export function useReviewRuns(filters?: {
  repo?: string;
  prNumber?: number;
  status?: ReviewRun['status'];
  enabled?: boolean;
  limit?: number;
}) {
  const { github } = useGitHubClients();
  return useQuery<ReviewRun[]>({
    queryKey: reviewRunKeys.list({
      repo: filters?.repo,
      prNumber: filters?.prNumber,
      status: filters?.status,
    }),
    enabled: filters?.enabled ?? true,
    queryFn: () => github.listReviewRuns({
      repo: filters?.repo,
      prNumber: filters?.prNumber,
      status: filters?.status,
      limit: filters?.limit ?? 200,
    }),
    refetchInterval: (query) => {
      const runs = query.state.data ?? [];
      const hasActive = runs.some((run) => run.status === 'queued' || run.status === 'running');
      return hasActive ? 1500 : false;
    },
  });
}

export function useCreateReviewRun() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation<ReviewRun, Error, CreateReviewRunInput>({
    mutationFn: (input) => github.createReviewRun({ ...input, async: input.async ?? true }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: reviewRunKeys.all });
    },
  });
}

export function useGenerateReviewDraft() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation<ReviewRun, Error, { runId: string; verificationStatus?: VerificationStatus; verificationNote?: string }>({
    mutationFn: ({ runId, verificationStatus, verificationNote }) =>
      github.generateReviewDraft(runId, { verificationStatus, verificationNote }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: reviewRunKeys.all });
    },
  });
}

export function usePostReviewRun() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation<ReviewRun, Error, { runId: string; verificationStatus?: VerificationStatus; verificationNote?: string }>({
    mutationFn: ({ runId, verificationStatus, verificationNote }) =>
      github.postReviewRun(runId, { verificationStatus, verificationNote }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: reviewRunKeys.all });
    },
  });
}

export function useReviewRunEventsMap(params: {
  runIds: string[];
  enabled?: boolean;
  refetchIntervalMs?: number;
  limit?: number;
}) {
  const { github } = useGitHubClients();
  const queries = useQueries({
    queries: params.runIds.map((runId) => ({
      queryKey: reviewRunKeys.events(runId),
      enabled: (params.enabled ?? true) && Boolean(runId),
      queryFn: () => github.listReviewRunEvents(runId, { limit: params.limit ?? 200 }),
      refetchInterval: params.refetchIntervalMs ?? 1500,
    })),
  });

  const byRunId = useMemo(() => {
    const map: Record<string, ReviewRunEvent[]> = {};
    for (let i = 0; i < params.runIds.length; i += 1) {
      const runId = params.runIds[i];
      map[runId] = (queries[i]?.data ?? []) as ReviewRunEvent[];
    }
    return map;
  }, [params.runIds, queries]);

  return {
    byRunId,
    isLoading: queries.some((query) => query.isLoading),
    isError: queries.some((query) => query.isError),
    error: queries.find((query) => query.error)?.error as Error | undefined,
  };
}
