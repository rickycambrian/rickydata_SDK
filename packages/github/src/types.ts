// === GitHub Types ===

export interface GitHubInstallation {
  id: string;
  owner: string;
  repos: string[];
  trustTier: 'sandbox' | 'standard' | 'trusted';
  killSwitch: boolean;
  policy: InstallationPolicy;
  triggers: InstallationTriggers;
  stats?: InstallationStats;
  createdAt: string;
  updatedAt: string;
}

export interface InstallationPolicy {
  autoResolve: boolean;
  maxConcurrent: number;
  allowedLabels: string[];
  blockedLabels: string[];
}

export interface InstallationTriggers {
  onIssueOpen: boolean;
  onIssueLabeled: boolean;
  labelTrigger: string;
}

export interface InstallationStats {
  totalResolved: number;
  autoPrCount: number;
  queueReviewCount: number;
  rejectedCount: number;
  avgResolutionTime: number;
  successRate: number;
}

export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  repo: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
  difficulty?: 'simple' | 'medium' | 'complex';
  recommendedModel?: string;
  estimatedCost?: number;
  resolutionStatus?: ResolutionStatus;
}

export type ResolutionStatus =
  | 'pending'
  | 'in_progress'
  | 'auto_pr'
  | 'queue_review'
  | 'rejected'
  | 'merged'
  | 'closed';

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  branch: string;
  state: 'open' | 'closed' | 'merged';
  repo: string;
  owner: string;
  ciStatus: CIStatus;
  reviewStatus: ReviewStatus;
  diff?: string;
  createdAt: string;
  updatedAt: string;
  executionId?: string;
}

export type CIStatus = 'pending' | 'passing' | 'failing' | 'unknown';
export type ReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'dismissed';

// === Pipeline Types ===

export interface PipelineResolveRequest {
  repo: string;
  issueNumber: number;
  dryRun?: boolean;
  model?: string;
  budget?: number;
}

export interface PipelineResolveResponse {
  executionId: string;
  status: 'started' | 'dry_run_complete';
  scan?: ScanResult;
  recommendation?: ModelRecommendation;
  estimatedCost?: number;
}

export interface ScanResult {
  difficulty: 'simple' | 'medium' | 'complex';
  tractability: number;
  language: string;
  issueType: string;
  filesEstimate: number;
  linesEstimate: number;
}

export interface ModelRecommendation {
  model: string;
  config: string;
  expectedQuality: number;
  expectedCost: number;
  roi: number;
  reasoning: string;
}

export interface PipelineStatus {
  scanner: ComponentStatus;
  recommender: ComponentStatus;
  executor: ComponentStatus;
  feedback: ComponentStatus;
  overall: 'healthy' | 'degraded' | 'down';
}

export interface ComponentStatus {
  status: 'healthy' | 'degraded' | 'down';
  lastCheck: string;
  message?: string;
}

// === Feedback Types ===

export interface FeedbackOutcome {
  executionId: string;
  repo: string;
  issueNumber: number;
  model: string;
  config: string;
  status: 'pending' | 'merged' | 'closed' | 'revised';
  quality?: number;
  confidence: number;
  diff?: string;
  reasoning?: string;
  createdAt: string;
  updatedAt: string;
  prNumber?: number;
  issueTitle?: string;
  scan?: ScanResult;
  recommendation?: ModelRecommendation;
}

export interface FeedbackSummary {
  totalExecutions: number;
  mergedCount: number;
  closedCount: number;
  pendingCount: number;
  revisedCount: number;
  avgQuality: number;
  avgConfidence: number;
  totalCost: number;
  costSavings: number;
}

export interface FeedbackAccuracy {
  overall: number;
  byModel: Record<string, number>;
  byDifficulty: Record<string, number>;
  timeline: AccuracyPoint[];
}

export interface AccuracyPoint {
  date: string;
  accuracy: number;
  count: number;
}

export interface DriftAlert {
  id: string;
  type: 'quality_drop' | 'cost_increase' | 'success_rate_drop';
  severity: 'low' | 'medium' | 'high';
  model: string;
  message: string;
  detectedAt: string;
  currentValue: number;
  expectedValue: number;
}

export interface RateRequest {
  rating: 'thumbs_up' | 'thumbs_down';
  comment?: string;
}

// === Work Session Types ===

export interface WorkSession {
  id: string;
  issueId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  model: string;
  tokenUsage?: number;
  cost?: number;
}

// === Answer Sheet Types ===

export interface AnswerSheet {
  id: string;
  title: string;
  category: string;
  errorSignature: string;
  steps: AnswerSheetStep[];
  confidence: number;
  qualityTier: 'HIGH' | 'MEDIUM' | 'LOW';
  usageCount: number;
}

export interface AnswerSheetStep {
  order: number;
  tool: string;
  action: string;
  rationale: string;
}

export interface AnswerSheetMatch {
  sheet: AnswerSheet;
  score: number;
  matchType: 'regex' | 'semantic' | 'hybrid';
}

// === Review Queue Types ===

export type VerificationStatus = 'not_checked' | 'user_confirmed' | 'agent_verified' | 'regression_found';
export type ReviewRunStatus = 'queued' | 'running' | 'completed' | 'blocked_missing_secrets' | 'failed' | 'posted';
export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'info' | 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

export interface ReviewRunError {
  error: string;
  code:
    | 'missing_secrets'
    | 'budget_exceeded'
    | 'invalid_model_output'
    | 'github_access_denied'
    | 'installation_not_found'
    | 'auth_required';
  message: string;
  retryable: boolean;
  diagnostics?: Record<string, unknown>;
  missingSecrets?: Array<{
    serverId?: string;
    serverName?: string;
    secretKeys: string[];
  }>;
}

export interface ReviewRunEvent {
  seq: number;
  runId: string;
  correlationId?: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  phase?: string;
  status?: ReviewRunStatus;
  data?: Record<string, unknown>;
}

export interface ReviewRun {
  runId: string;
  correlationId?: string;
  repo: string;
  prNumber: number;
  model: string;
  status: ReviewRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  phase?: string;
  phaseUpdatedAt?: string;
  review?: {
    reviewId: string;
    score: number;
    confidence: number;
    summary: string;
    model: string;
    issues: ReviewIssue[];
    suggestions: string[];
    timestamp: string;
  };
  evidence?: {
    syncedAt: string;
    checks: {
      allPassed?: boolean;
      anyFailed?: boolean;
      pending?: boolean;
      totalCount?: number;
      checkRuns?: Array<{
        name: string;
        status: string;
        conclusion: string | null;
      }>;
    } | null;
  };
  humanVerification: {
    status: VerificationStatus;
    note?: string;
    updatedAt: string;
  };
  recommendation?: {
    decision: ReviewDecision;
    rationale: string;
    score: number;
    confidence: number;
    hasMajorIssues: boolean;
    hasFailingChecks: boolean;
    verificationStatus: VerificationStatus;
  };
  generatedReviewBody?: string;
  githubReview?: {
    id: number;
    htmlUrl: string;
    state: string;
    submittedAt?: string;
    event: ReviewDecision;
  };
  error?: ReviewRunError;
  events?: ReviewRunEvent[];
  plannedLikelihood?: {
    expectedSuccess?: number;
    expectedCost?: number;
    confidenceLower?: number;
    confidenceUpper?: number;
    model?: string;
  };
}

// === Team Review Types ===

export type TeamReviewAgentRole =
  | 'security' | 'correctness' | 'performance'
  | 'test_coverage' | 'style' | 'architecture';

export type FindingSeverity = 'critical' | 'major' | 'minor' | 'nit' | 'praise';
export type FindingCategory = 'bug' | 'security' | 'performance' | 'style' | 'test' | 'docs' | 'architecture' | 'other';
export type FindingContext = 'normal' | 'nit' | 'pre_existing';

export interface TeamReviewFinding {
  id: string;
  agentRole: TeamReviewAgentRole;
  severity: FindingSeverity;
  category: FindingCategory;
  context: FindingContext;
  file: string;
  line?: number;
  endLine?: number;
  title: string;
  body: string;
  suggestion?: string;
  confidence: number;
}

export interface TeamReviewAgentResult {
  agentRole: TeamReviewAgentRole;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  findings: TeamReviewFinding[];
  summary?: string;
  error?: string;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  cost?: string;
}

export interface TeamReviewConfig {
  agents?: TeamReviewAgentRole[];
  model?: string;
  perAgentModel?: Partial<Record<TeamReviewAgentRole, string>>;
  maxFindingsPerAgent?: number;
  reviewMdContent?: string;
  focusFiles?: string[];
  ignorePatterns?: string[];
  severity?: {
    minSeverity?: FindingSeverity;
    includeNits?: boolean;
    includePraise?: boolean;
  };
}

export interface TeamReviewData {
  config: TeamReviewConfig;
  agents: TeamReviewAgentResult[];
  aggregatedFindings: TeamReviewFinding[];
  stats: {
    totalFindings: number;
    bySeverity: Partial<Record<FindingSeverity, number>>;
    byCategory: Partial<Record<FindingCategory, number>>;
    byAgent: Partial<Record<TeamReviewAgentRole, number>>;
  };
  reviewMdUsed: boolean;
  startedAt?: string;
  completedAt?: string;
  totalCost?: string;
}

export interface TeamReviewRun extends ReviewRun {
  teamReview?: TeamReviewData;
}

export interface TeamReviewRunEvent extends ReviewRunEvent {
  agentRole?: TeamReviewAgentRole;
  eventKind?:
    | 'team_started' | 'agent_started' | 'agent_finding'
    | 'agent_completed' | 'agent_failed'
    | 'aggregation_started' | 'aggregation_completed'
    | 'team_completed' | 'team_failed';
  finding?: TeamReviewFinding;
}

export interface ReviewTriggerComment {
  command: 'review';
  options?: {
    model?: string;
    agents?: TeamReviewAgentRole[];
    focus?: string[];
  };
  rawComment: string;
  commentId: number;
  commentAuthor: string;
}

// === Common ===

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ListOptions {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}
