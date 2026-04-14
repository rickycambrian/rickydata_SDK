/**
 * Pipeline Type Definitions
 *
 * Types for the autonomous issue resolution pipeline -- the end-to-end
 * system that scans repos for issues, recommends the optimal model,
 * executes fixes, and feeds outcomes back to improve recommendations.
 *
 * These types mirror the gateway implementation in mcp_deployments_registry
 * (mcp-agent-gateway/src/) and the Python reference in ai_research
 * (src/execution/execution_bridge.py).
 */

// ── Provider ─────────────────────────────────────────────────────────────────

export type PipelineProvider = 'claude' | 'anthropic' | 'minimax' | 'openrouter' | 'zai' | 'openclaude';
export type PipelineExecutionEngine = 'claude' | 'openclaude';

export const MINIMAX_MODEL = 'MiniMax-M2.7' as const;
export const GLM_MODEL = 'glm-5.1' as const;

// ── Resolve Request / Response ───────────────────────────────────────────────

export interface PipelineResolveOptions {
  /** Execution mode: "local" uses resolve_issue.py, "remote" delegates to gateway */
  mode?: 'local' | 'remote';
  /** Override model selection (skips ROI routing). E.g. "claude-haiku", "claude-sonnet" */
  model?: string;
  /** AI provider. Defaults to 'minimax'. */
  provider?: PipelineProvider;
  /** Execution engine to request from compatible gateway runtimes. */
  executionEngine?: PipelineExecutionEngine;
  /** Maximum spend in USD for this resolution */
  budget_usd?: number;
  /** Subprocess timeout in seconds (default: 600) */
  timeout_seconds?: number;
}

export interface PipelineResolveRequest {
  /** Repository in "owner/name" format */
  repo: string;
  /** GitHub issue number */
  issue_number: number;
  options?: PipelineResolveOptions;
}

export interface PipelineResolveResponse {
  /** Unique identifier for this resolution run */
  run_id: string;
  /** Resolved repo slug */
  repo: string;
  issue_number: number;
  /** Whether the pipeline accepted the request (not whether the fix succeeded) */
  accepted: boolean;
  /** Routing decision based on ROI data */
  routing: PipelineRouting;
  /** Link to the created pull request (if resolution succeeded) */
  pr_url?: string;
  /** Resolution status */
  status: PipelineRunStatus;
  /** ISO-8601 timestamp */
  created_at: string;
}

export interface PipelineRouting {
  /** Selected model config (e.g. "claude-haiku", "claude-sonnet") */
  model: string;
  /** Execution engine actually used when the backend reports it. */
  engineUsed?: PipelineExecutionEngine;
  /** Expected success rate from ROI data [0, 1] */
  expected_success_rate: number;
  /** Expected cost in USD */
  expected_cost_usd: number;
  /** ROI quality/dollar ratio */
  roi: number;
  /** Routing reason */
  reasoning: string;
}

// ── Pipeline Status ───────────────────────────────────────────────────────────

export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

export interface PipelineStatusResponse {
  /** Whether the pipeline service is healthy */
  healthy: boolean;
  /** ISO-8601 timestamp of status check */
  checked_at: string;
  /** Number of runs currently in flight */
  active_runs: number;
  /** Total runs processed since last restart */
  total_runs: number;
  /** Success rate across all runs [0, 1] */
  success_rate: number;
  /** ROI data freshness */
  roi_data: PipelineROIDataStatus;
}

export interface PipelineROIDataStatus {
  /** Whether ROI data is loaded */
  loaded: boolean;
  /** ISO-8601 timestamp of last ROI snapshot */
  last_updated?: string;
  /** Number of repos in the ROI snapshot */
  repos_count?: number;
  /** Number of model configurations in the snapshot */
  configs_count?: number;
}

// ── Outcome Feedback ──────────────────────────────────────────────────────────

export type PipelineOutcomeType =
  | 'merged'     // PR was merged -- fix accepted
  | 'closed'     // PR was closed without merge -- fix rejected
  | 'timeout'    // Resolution timed out before completion
  | 'error';     // Unexpected error during resolution

export interface PipelineOutcomeReport {
  /** Run ID returned by resolve() */
  run_id: string;
  /** What happened to the resolution */
  outcome: PipelineOutcomeType;
  /** Requested execution engine for compatible gateway runtimes. */
  executionEngine?: PipelineExecutionEngine;
  /** Actual execution engine used when the backend reports it. */
  engineUsed?: PipelineExecutionEngine;
  /** Actual cost incurred in USD */
  actual_cost_usd?: number;
  /** Actual quality score (0.0 - 1.0) from scoring engine */
  actual_quality_score?: number;
  /** Actual duration in seconds */
  duration_seconds?: number;
  /** Free-text notes (e.g. reviewer comment, error message) */
  notes?: string;
}

export interface PipelineOutcomeResponse {
  /** Whether the feedback was recorded */
  recorded: boolean;
  /** Updated ROI entry for the model/config used */
  updated_roi?: PipelineROIUpdate;
  message?: string;
}

export interface PipelineROIUpdate {
  config_name: string;
  new_success_rate: number;
  new_avg_cost: number;
  new_avg_quality: number;
  sample_size: number;
}

// ── Client Config ─────────────────────────────────────────────────────────────

export interface PipelineClientConfig {
  /** Gateway API base URL (required for remote mode) */
  baseUrl?: string;
  /** API key for authentication (X-KF-API-Key header, required for remote mode) */
  apiKey?: string;
  /** Execution mode: 'remote' (default) calls gateway API, 'local' runs resolve_issue.py */
  mode?: 'remote' | 'local';
  /** Path to resolve_issue.py script (auto-detected if not set) */
  resolveScriptPath?: string;
  /** Path to Python interpreter (default: 'python3') */
  pythonPath?: string;
  /** Subprocess timeout in ms for local mode (default: 1800000 = 30min) */
  localTimeout?: number;
}

// ── Plan Proposal ────────────────────────────────────────────────────────────

export type PlanStatus =
  | 'pending'
  | 'revising'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'rejected';

export interface PipelineProposeRequest {
  /** Repository in "owner/name" format */
  repo: string;
  /** GitHub issue number */
  issue_number: number;
  /** Override model selection */
  model?: string;
  /** Maximum spend in USD */
  budget_usd?: number;
}

export interface PipelineProposeResponse {
  /** Unique identifier for this plan */
  run_id: string;
  repo: string;
  issue_number: number;
  status: PlanStatus;
  confidence: number;
  model: string;
  estimated_cost: number;
  /** URL of the GitHub comment with the plan */
  comment_url: string;
  created_at: string;
}

export interface PendingPlan {
  run_id: string;
  repo: string;
  issue_number: number;
  status: PlanStatus;
  confidence: number;
  model: string;
  budget: number;
  feedback: string[];
  created_at: string;
  updated_at: string;
}
