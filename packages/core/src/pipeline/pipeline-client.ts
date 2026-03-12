/**
 * Pipeline Client
 *
 * Client for the autonomous issue resolution pipeline. Submits issues for
 * autonomous resolution, checks service health, and reports outcomes back
 * to improve the ROI-based routing engine.
 *
 * Uses native fetch (Node 18+) -- no external dependencies.
 */

import type {
  PipelineClientConfig,
  PipelineResolveRequest,
  PipelineResolveResponse,
  PipelineResolveOptions,
  PipelineStatusResponse,
  PipelineOutcomeReport,
  PipelineOutcomeResponse,
} from './types.js';

export class PipelineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: PipelineClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Resolve ───────────────────────────────────────────────────────────────

  /**
   * Submit a GitHub issue for autonomous resolution.
   *
   * The pipeline will:
   * 1. Scan the issue and classify difficulty/type
   * 2. Route to the optimal model using benchmark ROI data
   *    - Simple issues (<=30 lines, 1 file) → haiku ($0.009/run, ROI 40.6)
   *    - Complex issues (3+ files, architectural) → sonnet ($0.082/run, ROI 5.3)
   * 3. Execute via resolve_issue.py (local) or Claude agent runner (remote)
   * 4. Create a PR if confidence >= 0.70, queue for review if 0.40-0.70
   *
   * Returns immediately with a run_id. Poll getStatus() or subscribe to
   * webhooks for completion events.
   */
  async resolve(
    repo: string,
    issueNumber: number,
    opts?: PipelineResolveOptions,
  ): Promise<PipelineResolveResponse> {
    if (!repo) throw new Error('repo is required');
    if (!issueNumber || issueNumber <= 0) throw new Error('issueNumber must be a positive integer');

    const body: PipelineResolveRequest = {
      repo,
      issue_number: issueNumber,
      options: opts,
    };

    const res = await this.request('/api/v1/pipeline/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'submit issue for resolution');
    }

    return res.json();
  }

  // ── Status ────────────────────────────────────────────────────────────────

  /**
   * Get pipeline service health and aggregate statistics.
   *
   * Useful for checking whether the pipeline is available before submitting
   * issues, and for monitoring overall throughput and success rates.
   */
  async getStatus(): Promise<PipelineStatusResponse> {
    const res = await this.request('/api/v1/pipeline/status');

    if (!res.ok) {
      await this.throwFromResponse(res, 'get pipeline status');
    }

    return res.json();
  }

  // ── Outcome Feedback ──────────────────────────────────────────────────────

  /**
   * Report the outcome of a completed resolution run.
   *
   * This closes the self-improvement loop: outcome data feeds back into the
   * ROI engine so future routing recommendations improve over time.
   *
   * Call this when:
   * - A PR gets merged (outcome: "merged")
   * - A PR is closed without merge (outcome: "closed")
   * - The resolution timed out (outcome: "timeout")
   * - An unexpected error occurred (outcome: "error")
   *
   * Including actual_cost_usd and actual_quality_score enables the ROI engine
   * to produce better-calibrated recommendations.
   */
  async reportOutcome(outcome: PipelineOutcomeReport): Promise<PipelineOutcomeResponse> {
    if (!outcome.run_id) throw new Error('run_id is required');
    if (!outcome.outcome) throw new Error('outcome type is required');

    const res = await this.request('/api/feedback/outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outcome),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'report pipeline outcome');
    }

    return res.json();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-KF-API-Key': this.apiKey,
      ...(init?.headers as Record<string, string> || {}),
    };

    return globalThis.fetch(url, {
      ...init,
      headers,
    });
  }

  private async throwFromResponse(res: Response, action: string): Promise<never> {
    let errorBody: string;
    try {
      errorBody = await res.text();
    } catch {
      errorBody = '';
    }

    throw new Error(`Failed to ${action}: ${res.status} ${errorBody}`);
  }
}
