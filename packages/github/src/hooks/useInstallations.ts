import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useGitHubClients } from '../provider.js';
import type { GitHubInstallation, InstallationPolicy, InstallationTriggers } from '../types.js';

export const installationKeys = {
  all: ['github-installations'] as const,
  list: () => [...installationKeys.all, 'list'] as const,
  stats: (id: string) => [...installationKeys.all, 'stats', id] as const,
};

export function useInstallations() {
  const { github } = useGitHubClients();
  return useQuery({
    queryKey: installationKeys.list(),
    queryFn: () => github.listInstallations(),
  });
}

export function useRegisterInstallation() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { installationId: string; repos: string[] }) =>
      github.registerInstallation(args.installationId, args.repos),
    onSuccess: () => qc.invalidateQueries({ queryKey: installationKeys.all }),
  });
}

export function useUpdatePolicy() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { installationId: string; policy: Partial<InstallationPolicy> }) =>
      github.updatePolicy(args.installationId, args.policy),
    onSuccess: () => qc.invalidateQueries({ queryKey: installationKeys.all }),
  });
}

export function useUpdateTriggers() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { installationId: string; triggers: Partial<InstallationTriggers> }) =>
      github.updateTriggers(args.installationId, args.triggers),
    onSuccess: () => qc.invalidateQueries({ queryKey: installationKeys.all }),
  });
}

export function useSetTrustTier() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { installationId: string; tier: GitHubInstallation['trustTier'] }) =>
      github.setTrustTier(args.installationId, args.tier),
    onSuccess: () => qc.invalidateQueries({ queryKey: installationKeys.all }),
  });
}

export function useToggleKillSwitch() {
  const { github } = useGitHubClients();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { installationId: string; enabled: boolean }) =>
      github.toggleKillSwitch(args.installationId, args.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: installationKeys.all }),
  });
}

export function useInstallationStats(installationId: string) {
  const { github } = useGitHubClients();
  return useQuery({
    queryKey: installationKeys.stats(installationId),
    queryFn: () => github.getInstallationStats(installationId),
    enabled: !!installationId,
  });
}
