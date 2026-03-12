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
