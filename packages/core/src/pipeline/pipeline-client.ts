/**
 * Pipeline Client
 *
 * Client for the autonomous issue resolution pipeline. Submits issues for
 * autonomous resolution, checks service health, and reports outcomes back
 * to improve the ROI-based routing engine.
 *
 * Supports two modes:
 * - 'remote' (default): Calls the gateway API over HTTP.
 * - 'local': Runs resolve_issue.py as a subprocess.
 *
 * Uses native fetch (Node 18+) for remote mode, node:child_process for local.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type {
  PipelineClientConfig,
  PipelineProvider,
  PipelineResolveRequest,
  PipelineResolveResponse,
  PipelineResolveOptions,
  PipelineStatusResponse,
  PipelineOutcomeReport,
  PipelineOutcomeResponse,
  PipelineProposeRequest,
  PipelineProposeResponse,
  PendingPlan,
} from './types.js';

export class PipelineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly mode: 'remote' | 'local';
  private readonly resolveScriptPath: string;
  private readonly pythonPath: string;
  private readonly localTimeout: number;

  constructor(config: PipelineClientConfig) {
    this.mode = config.mode ?? 'remote';
    this.baseUrl = config.baseUrl?.replace(/\/$/, '') ?? '';
    this.apiKey = config.apiKey ?? '';
    this.pythonPath = config.pythonPath ?? 'python3';
    this.localTimeout = config.localTimeout ?? 1_800_000; // 30 min

    if (this.mode === 'local') {
      this.resolveScriptPath = config.resolveScriptPath ?? this._detectResolveScript();
    } else {
      this.resolveScriptPath = config.resolveScriptPath ?? '';
      // Validate remote config
      if (!this.baseUrl) throw new Error('baseUrl is required for remote mode');
      if (!this.apiKey) throw new Error('apiKey is required for remote mode');
    }
  }

  // ── Resolve ───────────────────────────────────────────────────────────────

  /**
   * Submit a GitHub issue for autonomous resolution.
   *
   * The pipeline will:
   * 1. Scan the issue and classify difficulty/type
   * 2. Route to the optimal model using benchmark ROI data
   *    - Simple issues (<=30 lines, 1 file) -> haiku ($0.009/run, ROI 40.6)
   *    - Complex issues (3+ files, architectural) -> sonnet ($0.082/run, ROI 5.3)
   * 3. Execute via resolve_issue.py (local) or Claude agent runner (remote)
   * 4. Create a PR if confidence >= 0.70, queue for review if 0.40-0.70
   *
   * In remote mode, returns immediately with a run_id. Poll getStatus() or
   * subscribe to webhooks for completion events.
   *
   * In local mode, blocks until resolve_issue.py completes (up to localTimeout).
   */
  async resolve(
    repo: string,
    issueNumber: number,
    opts?: PipelineResolveOptions,
  ): Promise<PipelineResolveResponse> {
    if (!repo) throw new Error('repo is required');
    if (!issueNumber || issueNumber <= 0) throw new Error('issueNumber must be a positive integer');

    if (this.mode === 'local') {
      return this._resolveLocal(repo, issueNumber, opts);
    }

    const provider = this._resolveProvider(opts?.provider, opts?.model);
    const body: PipelineResolveRequest = {
      repo,
      issue_number: issueNumber,
      options: { ...opts, provider },
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
   * In local mode, returns a synthetic healthy status (local execution is
   * always "available" if the script exists).
   */
  async getStatus(): Promise<PipelineStatusResponse> {
    if (this.mode === 'local') {
      return {
        healthy: true,
        checked_at: new Date().toISOString(),
        active_runs: 0,
        total_runs: 0,
        success_rate: 0,
        roi_data: { loaded: false },
      };
    }

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
   * In local mode, outcomes are tracked by resolve_issue.py's PredictionTracker
   * so this is a no-op that returns { recorded: true }.
   */
  async reportOutcome(outcome: PipelineOutcomeReport): Promise<PipelineOutcomeResponse> {
    if (!outcome.run_id) throw new Error('run_id is required');
    if (!outcome.outcome) throw new Error('outcome type is required');

    if (this.mode === 'local') {
      return { recorded: true, message: 'Local mode: outcome tracked by PredictionTracker' };
    }

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

  // ── Plan Proposal ────────────────────────────────────────────────────────

  /**
   * Propose a plan for an issue without executing it.
   * Posts a structured plan comment on the GitHub issue for review.
   *
   * In local mode, runs resolve_issue.py --plan-comment.
   */
  async propose(
    repo: string,
    issueNumber: number,
    opts?: { model?: string; budget_usd?: number },
  ): Promise<PipelineProposeResponse> {
    if (!repo) throw new Error('repo is required');
    if (!issueNumber || issueNumber <= 0) throw new Error('issueNumber must be a positive integer');

    if (this.mode === 'local') {
      return this._proposeLocal(repo, issueNumber, opts);
    }

    const body: PipelineProposeRequest = {
      repo,
      issue_number: issueNumber,
      model: opts?.model,
      budget_usd: opts?.budget_usd,
    };

    const res = await this.request('/api/v1/pipeline/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'propose plan');
    }

    return res.json();
  }

  /**
   * Approve a pending plan, triggering execution.
   */
  async approvePlan(
    runId: string,
    opts?: { model?: string; budget_usd?: number },
  ): Promise<PipelineResolveResponse> {
    if (!runId) throw new Error('runId is required');

    const res = await this.request(`/api/v1/pipeline/plans/${runId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts ?? {}),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'approve plan');
    }

    return res.json();
  }

  /**
   * Reject a pending plan.
   */
  async rejectPlan(runId: string): Promise<{ recorded: boolean }> {
    if (!runId) throw new Error('runId is required');

    const res = await this.request(`/api/v1/pipeline/plans/${runId}/reject`, {
      method: 'POST',
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'reject plan');
    }

    return res.json();
  }

  /**
   * Add feedback to a pending plan, triggering re-generation.
   */
  async addPlanFeedback(
    runId: string,
    feedback: string,
  ): Promise<PipelineProposeResponse> {
    if (!runId) throw new Error('runId is required');
    if (!feedback) throw new Error('feedback is required');

    const res = await this.request(`/api/v1/pipeline/plans/${runId}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback }),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'add plan feedback');
    }

    return res.json();
  }

  private _proposeLocal(
    repo: string,
    issueNumber: number,
    opts?: { model?: string; budget_usd?: number },
  ): PipelineProposeResponse {
    const runId = `local-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const args = [
      this.resolveScriptPath,
      `${repo}#${issueNumber}`,
      '--plan-comment',
      '--json',
    ];
    if (opts?.model) args.push('--model', opts.model);

    try {
      const stdout = execFileSync(this.pythonPath, args, {
        timeout: this.localTimeout,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
      const data = this._parseLocalOutput(stdout);
      return {
        run_id: runId,
        repo,
        issue_number: issueNumber,
        status: 'pending',
        confidence: data.confidence ?? 0.5,
        model: data.model ?? 'sonnet',
        estimated_cost: data.cost ?? 0,
        comment_url: '',
        created_at: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Local plan proposal failed: ${message.slice(0, 200)}`);
    }
  }

  // ── Provider Resolution ─────────────────────────────────────────────────

  /**
   * Derive the provider from explicit value, model prefix, or default.
   *  1. Explicit provider wins.
   *  2. Model starting with "MiniMax" -> 'minimax'.
   *  3. Model starting with "glm-" -> 'zai'.
   *  4. Claude-family aliases -> 'claude'.
   *  5. Default -> 'minimax'.
   */
  _resolveProvider(provider?: PipelineProvider, model?: string): PipelineProvider {
    if (provider) return provider;
    if (model?.startsWith('MiniMax')) return 'minimax';
    if (model && /^glm-/i.test(model)) return 'zai';
    if (model === 'haiku' || model === 'sonnet' || model === 'opus' || model?.startsWith('claude-')) {
      return 'claude';
    }
    return 'minimax';
  }

  // ── Local Mode ────────────────────────────────────────────────────────────

  private _resolveLocal(
    repo: string,
    issueNumber: number,
    opts?: PipelineResolveOptions,
  ): PipelineResolveResponse {
    const runId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const args = [
      this.resolveScriptPath,
      `${repo}#${issueNumber}`,
      '--execute', '--generate',
      '--agentic', '--auto-pr',
      '--force', '--json',
    ];

    if (opts?.budget_usd) {
      args.push('--budget', String(opts.budget_usd));
    }
    if (opts?.timeout_seconds) {
      args.push('--timeout', String(opts.timeout_seconds));
    }
    if (opts?.model) {
      args.push('--model', opts.model);
    }

    try {
      const stdout = execFileSync(this.pythonPath, args, {
        timeout: this.localTimeout,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50 MB
      });

      const result = this._parseLocalOutput(stdout);

      return {
        run_id: runId,
        repo,
        issue_number: issueNumber,
        accepted: true,
        routing: {
          model: result.model ?? 'claude-sonnet',
          expected_success_rate: result.confidence ?? 0.5,
          expected_cost_usd: result.cost ?? 0,
          roi: 0,
          reasoning: 'local execution via resolve_issue.py',
        },
        pr_url: result.pr_url,
        status: result.pr_url ? 'completed' : (result.error ? 'failed' : 'completed'),
        created_at: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        run_id: runId,
        repo,
        issue_number: issueNumber,
        accepted: true,
        routing: {
          model: 'unknown',
          expected_success_rate: 0,
          expected_cost_usd: 0,
          roi: 0,
          reasoning: `local execution failed: ${message.slice(0, 200)}`,
        },
        status: 'failed',
        created_at: new Date().toISOString(),
      };
    }
  }

  /** Parse JSON output from resolve_issue.py --json */
  private _parseLocalOutput(stdout: string): {
    pr_url?: string;
    model?: string;
    confidence?: number;
    cost?: number;
    error?: string;
  } {
    // resolve_issue.py --json outputs a JSON object.
    // Try parsing the last JSON object in the output (stdout may have log lines before it).
    const lines = stdout.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        try {
          const data = JSON.parse(line);
          return {
            pr_url: data.pr_url ?? data.pull_request_url,
            model: data.model,
            confidence: data.confidence ?? data.predicted_confidence,
            cost: data.cost ?? data.total_cost,
            error: data.error,
          };
        } catch {
          continue;
        }
      }
    }

    // Try full output as JSON
    try {
      const data = JSON.parse(stdout);
      return {
        pr_url: data.pr_url ?? data.pull_request_url,
        model: data.model,
        confidence: data.confidence ?? data.predicted_confidence,
        cost: data.cost ?? data.total_cost,
        error: data.error,
      };
    } catch {
      return { error: 'Failed to parse resolve_issue.py output' };
    }
  }

  /** Auto-detect the resolve_issue.py script path by checking common locations. */
  private _detectResolveScript(): string {
    const candidates = [
      join(homedir(), 'Documents', 'github', 'ai_research', 'scripts', 'resolve_issue.py'),
      join(process.cwd(), 'scripts', 'resolve_issue.py'),
      join(process.cwd(), '..', 'ai_research', 'scripts', 'resolve_issue.py'),
    ];

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }

    throw new Error(
      'resolve_issue.py not found. Set resolveScriptPath in PipelineClientConfig. ' +
      `Searched: ${candidates.join(', ')}`,
    );
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
