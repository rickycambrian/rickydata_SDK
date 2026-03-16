// Provider
export { GitHubProvider, useGitHubClients, type GitHubProviderProps } from './provider.js';

// Services
export { GitHubApi, type GitHubApiConfig, type CreateReviewRunInput, type CreateTeamReviewRunInput } from './services/github-api.js';
export { PipelineApi, type PipelineApiConfig } from './services/pipeline-api.js';
export { FeedbackApi, type FeedbackApiConfig } from './services/feedback-api.js';

// Hooks
export {
  useInstallations,
  useRegisterInstallation,
  useUpdatePolicy,
  useUpdateTriggers,
  useSetTrustTier,
  useToggleKillSwitch,
  useInstallationStats,
  installationKeys,
} from './hooks/useInstallations.js';
export { useGitHubIssues, issueKeys, type UseGitHubIssuesOptions } from './hooks/useGitHubIssues.js';
export { useGitHubRepo, repoKeys } from './hooks/useGitHubRepo.js';
export { usePipelineResolve } from './hooks/usePipelineResolve.js';
export { usePipelinePropose } from './hooks/usePipelinePropose.js';
export { useApprovePlan, useRejectPlan, useAddPlanFeedback, planKeys } from './hooks/usePlanActions.js';
export { usePipelineStatus, pipelineKeys } from './hooks/usePipelineStatus.js';
export { useStartSession, useCreatePR } from './hooks/useWorkSessions.js';
export { useFeedbackSummary, useFeedbackOutcome, feedbackKeys } from './hooks/useFeedbackOutcomes.js';
export { useReportOutcome } from './hooks/useReportOutcome.js';
export { useRateExecution } from './hooks/useRateExecution.js';
export { useROIMetrics } from './hooks/useROIMetrics.js';
export { answerSheetKeys } from './hooks/useAnswerSheets.js';
export {
  useReviewRuns,
  useCreateReviewRun,
  useGenerateReviewDraft,
  usePostReviewRun,
  useReviewRunEventsMap,
  reviewRunKeys,
} from './hooks/useReviewRuns.js';
export {
  useCreateTeamReview,
  useTeamReviewRun,
  useTeamReviewEvents,
  useTeamReview,
  teamReviewKeys,
} from './hooks/useTeamReview.js';

// Components
export { ConfidenceBadge } from './components/ConfidenceBadge.js';
export { DifficultyBadge } from './components/DifficultyBadge.js';
export { IssueCard } from './components/IssueCard.js';
export { PRCard } from './components/PRCard.js';
export { DiffViewer } from './components/DiffViewer.js';
export { PipelineStatusBar } from './components/PipelineStatusBar.js';
export { ReviewActions } from './components/ReviewActions.js';
export { ROIChart } from './components/ROIChart.js';
export { InstallationCard } from './components/InstallationCard.js';
export { TeamReviewProgress } from './components/TeamReviewProgress.js';
export { TeamReviewFindings } from './components/TeamReviewFindings.js';
export { TeamReviewSummary } from './components/TeamReviewSummary.js';

// Types
export type * from './types.js';
