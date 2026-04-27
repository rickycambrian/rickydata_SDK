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

export interface TestDeltaRecord {
  pre_passing: number;
  pre_failing: number;
  post_passing: number;
  post_failing: number;
  tests_fixed: number;
  regressions: number;
  functional_score: number;
  gold_tests_applied: boolean;
  gold_test_files: number;
  pre_output: string;
  post_output: string;
}

export interface BenchmarkTask {
  task_id: string;
  tenant_id: string;
  /** Repository in "owner/name" format */
  source_repo: string;
  issue_number: number;
  issue_title: string;
  /** Issue text with solution references stripped */
  sanitized_prompt: string;
  campaign_id?: string;
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
  test_command?: string;
  test_framework?: string;
  prompt_hash?: string;
  prompt_template_id?: string;
  task_manifest_id?: string;
  task_version?: string;
  created_at: string;
}

export interface CreateTaskRequest {
  task_id?: string;
  source_repo: string;
  issue_number: number;
  issue_title: string;
  sanitized_prompt: string;
  campaign_id?: string;
  base_commit?: string;
  gold_diff?: string;
  gold_files_changed?: string[];
  language?: string;
  issue_type?: string;
  complexity?: string;
  labels?: string[];
  test_command?: string;
  test_framework?: string;
  prompt_hash?: string;
  prompt_template_id?: string;
  task_manifest_id?: string;
  task_version?: string;
}

export interface TaskSearchOptions {
  source_repo?: string;
  language?: string;
  issue_type?: string;
  complexity?: string;
  campaign_id?: string;
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
  seat_adjusted_cost_usd?: number;
  monthly_seat_fraction?: number;
  concurrency_slots?: number;
  orchestrator_context_tokens?: number;
  cost_per_quality_point: number;
  tokens_per_file_changed: number;
}

export interface BenchmarkRun {
  run_id: string;
  tenant_id: string;
  task_id: string;
  campaign_id?: string;
  provider: string;
  model: string;
  runtime_family?: string;
  execution_mode?: string;
  orchestrator_provider?: string;
  orchestrator_model?: string;
  teammate_provider_models?: string[];
  attempt_policy?: string;
  trace_ref?: string;
  trace_artifact_hash?: string;
  trace_kg_ref?: string;
  trace_kg_summary?: unknown;
  reproduce_command?: string;
  evo_experiment_id?: string;
  public_summary_ref?: string;
  config_name?: string;
  execution_backend?: string;
  billing_profile?: string;
  actual_cost_usd?: number;
  stop_reason?: string;
  evidence_class?: string;
  thinking_mode: string;
  context_strategy: string;
  generated_diff?: string;
  quality_score?: DiffQualityScore;
  cost_metrics?: CostMetrics;
  duration_seconds: number;
  success: boolean;
  verification_level?: string;
  test_passed?: boolean;
  test_delta?: TestDeltaRecord;
  proof_manifest_hash?: string;
  proof_bundle?: unknown;
  proof_verified?: boolean;
  proof_verification_status?: string;
  proof_verification_error?: string;
  attestation_code_hash?: string;
  attestation_image_digest?: string;
  attestation_verdict?: string;
  error?: string;
  user_id?: string;
  repo?: string;
  created_at: string;
}

export interface RecordRunRequest {
  run_id?: string;
  task_id: string;
  campaign_id?: string;
  provider: string;
  model: string;
  runtime_family?: string;
  execution_mode?: string;
  orchestrator_provider?: string;
  orchestrator_model?: string;
  teammate_provider_models?: string[];
  attempt_policy?: string;
  trace_ref?: string;
  trace_artifact_hash?: string;
  trace_kg_ref?: string;
  trace_kg_summary?: unknown;
  reproduce_command?: string;
  evo_experiment_id?: string;
  public_summary_ref?: string;
  config_name?: string;
  execution_backend?: string;
  billing_profile?: string;
  actual_cost_usd?: number;
  stop_reason?: string;
  evidence_class?: string;
  thinking_mode?: string;
  context_strategy?: string;
  generated_diff?: string;
  quality_score?: DiffQualityScore;
  cost_metrics?: CostMetrics;
  duration_seconds?: number;
  success?: boolean;
  verification_level?: string;
  test_passed?: boolean;
  test_delta?: TestDeltaRecord;
  proof_manifest_hash?: string;
  proof_bundle?: unknown;
  proof_verified?: boolean;
  proof_verification_status?: string;
  proof_verification_error?: string;
  attestation_code_hash?: string;
  attestation_image_digest?: string;
  attestation_verdict?: string;
  error?: string;
  user_id?: string;
  repo?: string;
}

export interface RunSearchOptions {
  task_id?: string;
  campaign_id?: string;
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

export interface PublishBenchmarkCampaignRequest {
  campaign_id: string;
  title: string;
  summary?: string;
  methodology_refs?: string[];
  provenance_refs?: string[];
  manifest_hash?: string;
  notebook_ref?: string;
  export_refs?: string[];
  report_title?: string;
  report_summary_markdown?: string;
  report_author?: string;
  release_ready?: boolean;
}

export interface PublishBenchmarkCampaignResult {
  success: boolean;
  campaign_id: string;
  tasks_published: number;
  runs_published: number;
  report_id?: string;
  public_note_id?: string;
  transaction_id?: string;
  block_height?: number;
}

// ── Client Config ───────────────────────────────────────────────────────

export interface BenchmarkClientConfig {
  /** KFDB API base URL */
  baseUrl: string;
  /** API key for authentication (X-KF-API-Key header) */
  apiKey: string;
}
