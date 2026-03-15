import { useMemo, useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { CreateTeamReviewRunInput } from '../services/github-api.js';
import type {
  TeamReviewRun,
  TeamReviewRunEvent,
  TeamReviewAgentRole,
  TeamReviewFinding,
  FindingSeverity,
} from '../types.js';
import { reviewRunKeys } from './useReviewRuns.js';

export const teamReviewKeys = {
  all: ['team-review'] as const,
  detail: (runId: string) => [...teamReviewKeys.all, 'detail', runId] as const,
  events: (runId: string) => [...teamReviewKeys.all, 'events', runId] as const,
};

export function useCreateTeamReview() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation<TeamReviewRun, Error, CreateTeamReviewRunInput>({
    mutationFn: (input) => github.createTeamReviewRun(input),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: teamReviewKeys.all });
      qc.invalidateQueries({ queryKey: reviewRunKeys.all });
    },
  });
}

export function useTeamReviewRun(runId: string | null, opts?: { enabled?: boolean }) {
  const { github } = useGitHubClients();
  return useQuery<TeamReviewRun>({
    queryKey: teamReviewKeys.detail(runId ?? ''),
    enabled: (opts?.enabled ?? true) && Boolean(runId),
    queryFn: () => github.getTeamReviewRun(runId!),
    refetchInterval: (query) => {
      const run = query.state.data;
      if (!run) return false;
      return run.status === 'queued' || run.status === 'running' ? 1500 : false;
    },
  });
}

export function useTeamReviewEvents(runId: string | null, opts?: { enabled?: boolean }) {
  const { github } = useGitHubClients();
  const [events, setEvents] = useState<TeamReviewRunEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const enabled = (opts?.enabled ?? true) && Boolean(runId);

  useEffect(() => {
    if (!enabled || !runId) return;
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const lastSeq = events.length > 0 ? events[events.length - 1].seq : undefined;
        for await (const event of github.streamTeamReviewEvents(runId, {
          after: lastSeq,
          signal: controller.signal,
        })) {
          setEvents((prev) => [...prev, event]);
        }
      } catch {
        // Stream ended or aborted
      }
    })();

    return () => { controller.abort(); };
  }, [enabled, runId, github]); // eslint-disable-line react-hooks/exhaustive-deps

  const agentStatuses = useMemo(() => {
    const map: Partial<Record<TeamReviewAgentRole, 'pending' | 'running' | 'completed' | 'failed'>> = {};
    for (const event of events) {
      if (!event.agentRole) continue;
      if (event.eventKind === 'agent_started') map[event.agentRole] = 'running';
      if (event.eventKind === 'agent_completed') map[event.agentRole] = 'completed';
      if (event.eventKind === 'agent_failed') map[event.agentRole] = 'failed';
    }
    return map;
  }, [events]);

  const findings = useMemo(() => {
    return events
      .filter((e): e is TeamReviewRunEvent & { finding: TeamReviewFinding } => Boolean(e.finding))
      .map((e) => e.finding);
  }, [events]);

  const stats = useMemo(() => {
    const bySeverity: Partial<Record<FindingSeverity, number>> = {};
    for (const f of findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    }
    return { totalFindings: findings.length, bySeverity };
  }, [findings]);

  const reset = useCallback(() => { setEvents([]); }, []);

  return { events, agentStatuses, findings, stats, reset };
}

export function useTeamReview(runId: string | null) {
  const runQuery = useTeamReviewRun(runId);
  const { events, agentStatuses, findings, stats, reset } = useTeamReviewEvents(runId, {
    enabled: Boolean(runId),
  });

  return {
    run: runQuery.data,
    isLoading: runQuery.isLoading,
    error: runQuery.error,
    events,
    agentStatuses,
    findings,
    stats,
    reset,
    refetch: runQuery.refetch,
  };
}
