/**
 * Cycle Type Definitions
 *
 * Types for the autonomous loop cycle tracking system. Each cycle represents
 * one full scan-resolve-PR iteration across a set of repositories. The client
 * ingests cycle results, lists historical cycles, and retrieves aggregate
 * summaries for monitoring autonomous system performance.
 *
 * These types mirror the gateway implementation in mcp_deployments_registry
 * and the Python reference in ai_research (src/self_improving/).
 */

// ── Cycle Result ─────────────────────────────────────────────────────────────

export interface CycleResult {
  /** Unique identifier for this cycle run */
  cycle_id: string;
  /** Wallet address of the tenant that ran this cycle */
  walletAddress: string;
  /** ISO-8601 timestamp of cycle completion */
  timestamp: string;
  /** Repositories scanned in this cycle */
  repos: string[];
  /** Number of issues scanned across all repos */
  issues_scanned: number;
  /** Number of issues successfully resolved */
  issues_resolved: number;
  /** Number of pull requests created */
  prs_created: number;
  /** Total cost in USD for this cycle */
  total_cost: number;
  /** Total wall-clock duration in seconds */
  total_duration_s: number;
}

// ── List Response ────────────────────────────────────────────────────────────

export interface CycleListResponse {
  /** Array of cycle results */
  cycles: CycleResult[];
  /** Total count of cycles returned */
  count: number;
}

// ── Summary Response ─────────────────────────────────────────────────────────

export interface CycleSummaryResponse {
  /** Total number of cycles recorded */
  totalCycles: number;
  /** Total issues scanned across all cycles */
  totalScanned: number;
  /** Total issues resolved across all cycles */
  totalResolved: number;
  /** Total pull requests created across all cycles */
  totalPrs: number;
  /** Total cost in USD across all cycles */
  totalCost: number;
  /** Total duration in seconds across all cycles */
  totalDuration: number;
  /** Overall resolution rate [0, 1] (totalResolved / totalScanned) */
  resolutionRate: number;
}

// ── Ingest Request / Response ────────────────────────────────────────────────

export interface IngestCycleRequest {
  /** Unique identifier for this cycle run */
  cycle_id: string;
  /** ISO-8601 timestamp of cycle completion */
  timestamp: string;
  /** Repositories scanned in this cycle */
  repos: string[];
  /** Number of issues scanned across all repos */
  issues_scanned: number;
  /** Number of issues successfully resolved */
  issues_resolved: number;
  /** Number of pull requests created */
  prs_created: number;
  /** Total cost in USD for this cycle */
  total_cost: number;
  /** Total wall-clock duration in seconds */
  total_duration_s: number;
}

export interface IngestCycleResponse {
  /** Unique identifier echoed back */
  cycle_id: string;
  /** Whether the cycle was successfully recorded */
  recorded: boolean;
}

// ── Client Config ────────────────────────────────────────────────────────────

export interface CycleClientConfig {
  /** Gateway API base URL */
  baseUrl: string;
  /** API key for authentication (X-KF-API-Key header) */
  apiKey: string;
}
