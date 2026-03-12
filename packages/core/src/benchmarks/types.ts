/**
 * Benchmark Type Definitions
 *
 * Types for the benchmark system -- cost-adjusted model benchmarking
 * on real GitHub issues with ROI-based recommendations.
 *
 * These types mirror the Rust backend in knowledgeflow_db
 * (crates/kfdb-api/src/benchmark/types.rs) and the TypeScript
 * implementation in mcp_deployments_registry
 * (mcp-agent-gateway/src/benchmark/types.ts).
 */

// ── Benchmark Task ──────────────────────────────────────────────────────

export interface BenchmarkTask {
  task_id: string;
  tenant_id: string;
  /** Repository in "owner/name" format */
  source_repo: string;
  issue_number: number;
  issue_title: string;
  /** Issue text with solution references stripped */
  sanitized_prompt: string;
  /** Commit before the fix (checkout point) */
  base_commit: string;
  /** The known-good resolution diff */
  gold_diff: string;
  gold_files_changed: string[];
  language: string;
  /** bug_fix, feature, refactor */
  issue_type: string;
  /** simple, moderate, complex */
  complexity: string;
  labels: string[];
  created_at: string;
}

export interface CreateTaskRequest {
  source_repo: string;
  issue_number: number;
  issue_title: string;
  sanitized_prompt: string;
  base_commit?: string;
  gold_diff?: string;
  gold_files_changed?: string[];
  language?: string;
  issue_type?: string;
  complexity?: string;
  labels?: string[];
}

export interface TaskSearchOptions {
  source_repo?: string;
  language?: string;
  issue_type?: string;
  complexity?: string;
  limit?: number;
}

export interface TaskListResult {
  items: BenchmarkTask[];
  total: number;
}

// ── Benchmark Run ───────────────────────────────────────────────────────

export interface DiffQualityScore {
  files_overlap: number;
  hunks_overlap: number;
  exact_match: number;
  functional_match: number;
  over_engineering: number;
  composite: number;
}

export interface CostMetrics {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  cost_per_quality_point: number;
  tokens_per_file_changed: number;
}

export interface BenchmarkRun {
  run_id: string;
  tenant_id: string;
  task_id: string;
  provider: string;
  model: string;
  thinking_mode: string;
  context_strategy: string;
  generated_diff?: string;
  quality_score?: DiffQualityScore;
  cost_metrics?: CostMetrics;
  duration_seconds: number;
  success: boolean;
  error?: string;
  user_id?: string;
  repo?: string;
  created_at: string;
}

export interface RecordRunRequest {
  task_id: string;
  provider: string;
  model: string;
  thinking_mode?: string;
  context_strategy?: string;
  generated_diff?: string;
  quality_score?: DiffQualityScore;
  cost_metrics?: CostMetrics;
  duration_seconds?: number;
  success?: boolean;
  error?: string;
  user_id?: string;
  repo?: string;
}

export interface RunSearchOptions {
  task_id?: string;
  model?: string;
  user_id?: string;
  repo?: string;
  limit?: number;
}

export interface RunListResult {
  items: BenchmarkRun[];
  total: number;
}

// ── ROI Recommendation ──────────────────────────────────────────────────

export interface ROIRecommendation {
  cache_key: string;
  tenant_id: string;
  config_name: string;
  expected_success_rate: number;
  expected_cost_usd: number;
  cost_per_success: number;
  quality_adjusted_cost: number;
  confidence_interval_lo: number;
  confidence_interval_hi: number;
  sample_size: number;
  stratum: string;
  reasoning: string;
  computed_at: string;
}

export interface ROIQuery {
  issue_type?: string;
  language?: string;
  complexity?: string;
  user_id?: string;
  repo?: string;
  budget_constraint?: number;
  top_k?: number;
}

export interface ROIResult {
  recommendations: ROIRecommendation[];
  stratum: string;
  total_data_points: number;
  message?: string;
}

export interface CacheROIRequest {
  cache_key: string;
  recommendations: ROIRecommendation[];
}

// ── Stats ───────────────────────────────────────────────────────────────

export interface ConfigStatEntry {
  config_name: string;
  total_runs: number;
  successes: number;
  success_rate: number;
  avg_cost: number;
  avg_quality: number;
}

export interface BenchmarkStats {
  total_tasks: number;
  total_runs: number;
  repos: string[];
  models: string[];
  config_stats: ConfigStatEntry[];
}

// ── Client Config ───────────────────────────────────────────────────────

export interface BenchmarkClientConfig {
  /** KFDB API base URL */
  baseUrl: string;
  /** API key for authentication (X-KF-API-Key header) */
  apiKey: string;
}
