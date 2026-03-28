import type {
  KfdbClientConfig,
  KfdbFilterEntitiesRequest,
  KfdbGetEntityOptions,
  KfdbListEntitiesOptions,
  KfdbQueryScope,
  KfdbWriteRequest,
} from '../kfdb/types.js';

export type ResearchVisibility = 'private';
export type ResearchReadScope = Extract<KfdbQueryScope, 'private'>;
export type ResearchProvider = 'minimax' | 'anthropic' | 'claude';
export type ResearchRunStatus =
  | 'draft'
  | 'registered'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'promoted'
  | 'failed';
export type ResearchVerdict = 'supported' | 'refuted' | 'inconclusive' | 'abstain';
export type EvidenceGrade = 'E0' | 'E1' | 'E2' | 'E3' | 'E4';
export type ResearchEventType =
  | 'run_registered'
  | 'hypothesis_registered'
  | 'trace_mined'
  | 'benchmark_selected'
  | 'control_completed'
  | 'treatment_completed'
  | 'verification_completed'
  | 'verifier_feedback'
  | 'claim_promoted'
  | 'claim_abstained'
  | 'human_review_recorded'
  | 'issue_drafted'
  | 'issue_created'
  | 'issue_dismissed';
export type FrictionSourceType =
  | 'issue_report'
  | 'benchmark_failure'
  | 'verifier_finding'
  | 'agent_friction'
  | 'manual';
export type FrictionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueEscalationStatus = 'draft' | 'created' | 'dismissed';
export type IssueEscalationMode = 'draft_only' | 'auto_open';
export type SanitizationStatus = 'clean' | 'redacted' | 'blocked';
export type SkillCandidateStage =
  | 'wallet_candidate'
  | 'wallet_validated'
  | 'global_candidate'
  | 'global'
  | 'rejected';
export type SkillBacktestVerdict = 'positive' | 'negative' | 'inconclusive';
export type PromotionDecisionType =
  | 'reject'
  | 'validate_wallet'
  | 'promote_global_candidate'
  | 'promote_global';

export interface ResearchPrivacyContext {
  walletAddress: string;
  projectId: string;
  workspaceId: string;
  visibility: ResearchVisibility;
  readScope: ResearchReadScope;
  allowGlobalInputs: boolean;
  tags?: string[];
}

export interface ResearchAgentSpec {
  id: string;
  name: string;
  description: string;
  provider: ResearchProvider;
  allowedTools: string[];
  toolPriority: string[];
  setupRequirements: string[];
  workflowStages: string[];
  outputSchema: Record<string, unknown>;
  abstentionConditions: string[];
  verificationHooks: string[];
  bannedTools?: string[];
  repoContextAllowed?: boolean;
  liveFetchRequired?: boolean;
  notes?: string;
}

export interface ResearchPolicyArm {
  id: string;
  label: string;
  provider: ResearchProvider;
  model: string;
  strategy: 'baseline' | 'one_pass' | 'generate_verify_revise' | 'premium_control';
  maxBudgetUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface PublicInputSnapshot {
  id: string;
  sourceType: 'github_issue' | 'github_repo' | 'benchmark_task' | 'paper' | 'dataset' | 'other';
  sourceRef: string;
  capturedAt: string;
  visibility: ResearchVisibility;
  scope: ResearchReadScope;
  payloadHash?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceEpisode {
  id: string;
  sessionId: string;
  projectId: string;
  workspaceId: string;
  source: string;
  startedAt: string;
  frictionType: string;
  toolSequence: string[];
  toolCallsInvolved: number;
  errorTypes: string[];
  failingTool?: string | null;
  resolutionTool?: string | null;
  rawEvidence?: string;
  durationMs?: number | null;
}

export interface ToolFailureSignature {
  id: string;
  frictionType: string;
  failingTool?: string | null;
  resolutionTool?: string | null;
  errorTypes: string[];
  triggerLabel: string;
  supportCount: number;
}

export interface SkillTrigger {
  whenToUse: string;
  doNotUse: string;
  failureSignatures: string[];
  correctToolCallPattern: string[];
}

export interface SkillEvidenceBundle {
  traceEpisodeIds: string[];
  sampleSize: number;
  successfulRecoveries: number;
  repoCount: number;
  evidence: string[];
  sourceRefs: string[];
}

export interface ResearchCandidate {
  id: string;
  title: string;
  summary: string;
  source: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface SkillCandidate {
  id: string;
  name: string;
  title: string;
  description: string;
  stage: SkillCandidateStage;
  privacyContext: ResearchPrivacyContext;
  signature: ToolFailureSignature;
  trigger: SkillTrigger;
  evidenceBundle: SkillEvidenceBundle;
  skillMarkdown: string;
  claudeRouterEntry: string;
  provider: ResearchProvider;
  model: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SkillBacktestResult {
  candidateId: string;
  totalEpisodes: number;
  matchedEpisodes: number;
  successfulMatches: number;
  coverageRate: number;
  consistencyRate: number;
  beforeAvgToolCalls: number;
  afterExpectedToolCalls: number;
  estimatedToolCallsSaved: number;
  verdict: SkillBacktestVerdict;
  notes?: string[];
  createdAt: string;
}

export interface PromotionDecision {
  candidateId: string;
  fromStage: SkillCandidateStage;
  toStage: SkillCandidateStage;
  decision: PromotionDecisionType;
  rationale: string;
  requiresHumanReview: boolean;
  approvedByHuman?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchClaim {
  id: string;
  title: string;
  statement: string;
  verdict: ResearchVerdict;
  evidenceGrade: EvidenceGrade;
  reproducibilityHash?: string;
  artifactLinks?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResearchVerification {
  verifier: string;
  summary: string;
  verdict: ResearchVerdict;
  evidenceGrade: EvidenceGrade;
  reproduced: boolean;
  statisticalReport?: Record<string, unknown>;
  verifierFeedback?: string[];
  artifactLinks?: string[];
  verifiedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface HumanAIInteractionCard {
  humanInputs?: string[];
  approvals?: string[];
  rejectedDrafts?: string[];
  toolTrace?: string[];
  notes?: string[];
}

export interface ResearchRunEvent {
  id: string;
  type: ResearchEventType;
  createdAt: string;
  actor?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchRun {
  id: string;
  title: string;
  hypothesis: string;
  benchmarkSetId?: string;
  status: ResearchRunStatus;
  provider: ResearchProvider;
  model: string;
  privacyContext: ResearchPrivacyContext;
  agentSpecs: ResearchAgentSpec[];
  policyArms: ResearchPolicyArm[];
  candidate?: ResearchCandidate;
  claim?: ResearchClaim;
  verification?: ResearchVerification;
  verdict?: ResearchVerdict;
  evidenceGrade?: EvidenceGrade;
  publicInputSnapshots?: PublicInputSnapshot[];
  artifactLinks?: string[];
  humanInteraction?: HumanAIInteractionCard;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFrictionFinding {
  id: string;
  title: string;
  summary: string;
  sourceType: FrictionSourceType;
  component: string;
  severity: FrictionSeverity;
  verifierApproved: boolean;
  evidence?: string[];
  suggestedAction?: string;
  repoHints?: string[];
  runId?: string;
  privacyContext: ResearchPrivacyContext;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface IssueEscalation {
  id: string;
  status: IssueEscalationStatus;
  mode: IssueEscalationMode;
  repo: string;
  installationId?: number;
  title: string;
  body: string;
  findingIds: string[];
  verifierApproved: boolean;
  sanitizationStatus: SanitizationStatus;
  dedupeKey?: string;
  issueNumber?: number;
  issueUrl?: string;
  artifactLinks?: string[];
  privacyContext: ResearchPrivacyContext;
  createdAt: string;
  updatedAt: string;
  dismissedAt?: string;
  dismissedReason?: string;
}

export interface ResearchClientConfig {
  baseUrl: string;
  token?: string;
  apiKey?: string;
}

export interface WalletSkillRecord {
  name: string;
  description: string;
  content: string;
  version?: string;
  updatedAt?: string;
  raw?: string;
}

export interface ResearchListRunsOptions {
  projectId?: string;
  workspaceId?: string;
  status?: ResearchRunStatus;
  verdict?: ResearchVerdict;
  limit?: number;
}

export interface SkillCandidateListOptions {
  projectId?: string;
  workspaceId?: string;
  stage?: SkillCandidateStage;
  limit?: number;
}

export interface ResearchListIssuesOptions {
  projectId?: string;
  workspaceId?: string;
  status?: IssueEscalationStatus;
  repo?: string;
  limit?: number;
}

export interface CreateResearchRunRequest {
  title: string;
  hypothesis: string;
  benchmarkSetId?: string;
  provider?: ResearchProvider;
  model?: string;
  privacyContext: ResearchPrivacyContext;
  agentSpecs?: ResearchAgentSpec[];
  policyArms?: ResearchPolicyArm[];
  candidate?: ResearchCandidate;
  publicInputSnapshots?: PublicInputSnapshot[];
  artifactLinks?: string[];
  humanInteraction?: HumanAIInteractionCard;
  metadata?: Record<string, unknown>;
  initialEvents?: Array<Omit<ResearchRunEvent, 'id' | 'createdAt'>>;
}

export type CreateSkillCandidateRequest = SkillCandidate;

export interface BacktestSkillCandidateRequest {
  backtest: SkillBacktestResult;
}

export interface PromoteSkillCandidateRequest {
  decision: PromotionDecision;
}

export interface VerifyResearchRunRequest {
  verification: ResearchVerification;
  artifactLinks?: string[];
}

export interface PromoteResearchRunRequest {
  claim: ResearchClaim;
  metadata?: Record<string, unknown>;
}

export interface AppendResearchRunEventRequest {
  type: ResearchEventType;
  summary: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}

export interface DraftResearchIssueRequest {
  privacyContext: ResearchPrivacyContext;
  repo: string;
  installationId?: number;
  mode?: IssueEscalationMode;
  artifactLinks?: string[];
  finding: Omit<ProductFrictionFinding, 'id' | 'createdAt' | 'privacyContext'>;
}

export interface CreateResearchIssueRequest {
  mode?: IssueEscalationMode;
}

export interface DismissResearchIssueRequest {
  reason?: string;
}

export interface TriggerSelfImprovementRequest {
  agentId?: string;
  includeBackfill?: boolean;
}

export interface SelfImprovementStatus {
  walletAddress?: string;
  running?: boolean;
  schedule?: Record<string, unknown> | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  history?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ResearchKFDBClientConfig extends Omit<KfdbClientConfig, 'defaultReadScope'> {
  privacyContext: ResearchPrivacyContext;
}

export interface ResearchEntityFilterOptions extends Omit<KfdbFilterEntitiesRequest, 'scope' | 'filters'> {
  filters?: Record<string, unknown>;
}

export interface ResearchListEntityOptions extends Omit<KfdbListEntitiesOptions, 'scope'> {}
export interface ResearchGetEntityOptions extends Omit<KfdbGetEntityOptions, 'scope'> {}

export interface ResearchWriteOptions {
  skipEmbedding?: boolean;
  operation?: 'create_node' | 'upsert_node';
}

export interface ResearchNodeWriteRequest {
  label: string;
  properties: Record<string, unknown>;
  options?: ResearchWriteOptions;
}

export interface ResearchSnapshotWriteRequest {
  label?: string;
  snapshot: PublicInputSnapshot;
}

export interface ResearchSqlValidationOptions {
  allowProjectFilter?: boolean;
  additionalPatterns?: RegExp[];
}

export interface ResearchPrivacyQueryGuard {
  validateSessionQuery(sql: string, options?: ResearchSqlValidationOptions): string;
}

export interface ResearchAgentCatalogEntry {
  spec: ResearchAgentSpec;
  origin: 'research_loop' | 'dogfood_reference';
}

export interface ResearchAgentCatalog {
  entries: ResearchAgentCatalogEntry[];
}

export type ResearchEntityWriteRequest = KfdbWriteRequest;
