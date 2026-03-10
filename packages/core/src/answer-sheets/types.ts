/**
 * Answer Sheet Type Definitions
 *
 * Types for the answer sheet system -- proven solution patterns
 * mined from successful agent sessions that can be reused to
 * resolve similar issues autonomously.
 *
 * These types mirror the Rust backend in knowledgeflow_db
 * (crates/kfdb-api/src/answer_sheets/types.rs).
 */

// ── Core Entity ────────────────────────────────────────────────────────────

export interface SolutionStep {
  /** Step number (1-based ordering) */
  step: number;
  /** MCP tool name or action type (e.g., "Edit", "Bash", "Grep") */
  tool: string;
  /** What this step does (e.g., "find_definition", "apply_fix", "verify") */
  action: string;
  /** Glob pattern for files this step targets */
  file_pattern?: string;
  /** Why this step is necessary */
  rationale: string;
}

export type ProblemCategory =
  | 'edit_mismatch'
  | 'test_failure'
  | 'import_error'
  | 'type_error'
  | 'build_failure'
  | 'runtime_error'
  | 'permission_error'
  | 'network_error'
  | 'config_error'
  | 'syntax_error'
  | 'dependency_error'
  | 'timeout';

export type MatchMethod = 'signature' | 'category' | 'embedding' | 'combined';

export interface AnswerSheet {
  answer_sheet_id: string;
  tenant_id: string;
  /** Regex or pattern that matches the error this sheet solves */
  error_signature: string;
  /** Category of problem */
  problem_category: string;
  /** Ordered steps to resolve the issue */
  solution_steps: SolutionStep[];
  /** Human-readable summary of the solution */
  solution_summary: string;
  /** Session IDs this pattern was mined from */
  source_session_ids: string[];
  /** Extraction IDs this pattern was derived from */
  source_extraction_ids: string[];
  /** Number of successful applications */
  success_count: number;
  /** Number of failed applications */
  failure_count: number;
  /** Bayesian confidence score: success / (success + failure + 5) */
  confidence: number;
  /** Repository or language context (JSON) */
  repo_context?: unknown;
  /** Programming languages this pattern applies to */
  languages: string[];
  /** Frameworks this pattern applies to */
  frameworks: string[];
  /** Searchable tags */
  tags: string[];
  /** Schema version for forward compatibility */
  version: number;
  /** Whether this sheet is visible to other tenants */
  is_public: boolean;
  created_at: string;
  updated_at: string;
  /** Who created this sheet (e.g., "pipeline", "manual") */
  created_by: string;
}

// ── Search / List ──────────────────────────────────────────────────────────

export interface AnswerSheetSearchOptions {
  /** Filter by problem category */
  problem_category?: string;
  /** Filter by programming language */
  language?: string;
  /** Filter by tag */
  tag?: string;
  /** Minimum confidence threshold (0.0 - 1.0) */
  min_confidence?: number;
  /** Include public sheets from other tenants */
  is_public?: boolean;
  /** Maximum number of results (default: 50) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

export interface AnswerSheetSearchResult {
  items: AnswerSheet[];
  total: number;
  limit: number;
  offset: number;
}

// ── Create ─────────────────────────────────────────────────────────────────

export interface CreateAnswerSheetRequest {
  error_signature: string;
  problem_category: string;
  solution_steps: SolutionStep[];
  solution_summary: string;
  source_session_ids?: string[];
  source_extraction_ids?: string[];
  languages?: string[];
  frameworks?: string[];
  tags?: string[];
  repo_context?: unknown;
  is_public?: boolean;
}

export interface CreateAnswerSheetResponse {
  answer_sheet_id: string;
  tenant_id: string;
  confidence: number;
  created_at: string;
}

// ── Update ─────────────────────────────────────────────────────────────────

export interface UpdateAnswerSheetRequest {
  error_signature?: string;
  problem_category?: string;
  solution_steps?: SolutionStep[];
  solution_summary?: string;
  source_session_ids?: string[];
  source_extraction_ids?: string[];
  languages?: string[];
  frameworks?: string[];
  tags?: string[];
  repo_context?: unknown;
  is_public?: boolean;
}

// ── Match ──────────────────────────────────────────────────────────────────

export interface AnswerSheetMatch {
  answer_sheet_id: string;
  /** How well this sheet matches the query (0.0 - 1.0) */
  match_score: number;
  /** Method used to find this match */
  match_method: MatchMethod;
  error_signature: string;
  problem_category: string;
  solution_summary: string;
  solution_steps: SolutionStep[];
  confidence: number;
  success_count: number;
  languages: string[];
  source_session_count: number;
}

export interface MatchAnswerSheetRequest {
  /** The error message or text to match against */
  error_text: string;
  /** Additional context to improve matching accuracy */
  context?: MatchContext;
  /** Maximum number of matches to return (default: 5) */
  limit?: number;
  /** Minimum confidence threshold (default: 0.2) */
  min_confidence?: number;
  /** Include public sheets from other tenants (default: true) */
  include_public?: boolean;
}

export interface MatchContext {
  /** Tool that triggered the error */
  tool_name?: string;
  /** Path of the file where the error occurred */
  file_path?: string;
  /** Programming language */
  language?: string;
  /** Recently used tools for context */
  recent_tools?: string[];
}

export interface MatchAnswerSheetResult {
  matches: AnswerSheetMatch[];
  /** Total candidates evaluated before filtering */
  total_candidates: number;
  /** Time spent searching (milliseconds) */
  search_time_ms: number;
}

// ── Feedback ───────────────────────────────────────────────────────────────

export interface AnswerSheetFeedbackRequest {
  /** Whether this answer sheet worked (true = confirm, false = reject) */
  positive: boolean;
  /** Optional context about the feedback */
  context?: string;
  /** Session ID where this sheet was applied */
  session_id?: string;
}

export interface AnswerSheetFeedbackResult {
  feedback_id: string;
  answer_sheet_id: string;
  /** Confidence before this feedback */
  old_confidence: number;
  /** Updated confidence score after feedback */
  new_confidence: number;
  /** Total successful applications */
  total_success: number;
  /** Total failed applications */
  total_failure: number;
}

// ── Client Config ──────────────────────────────────────────────────────────

export interface AnswerSheetClientConfig {
  /** KFDB API base URL */
  baseUrl: string;
  /** API key for authentication (X-KF-API-Key header) */
  apiKey: string;
}
