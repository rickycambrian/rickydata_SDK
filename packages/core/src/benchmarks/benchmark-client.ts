/**
 * Benchmark Client
 *
 * Client for managing benchmark tasks, recording run results,
 * and retrieving ROI recommendations. Communicates with the
 * KFDB REST API.
 *
 * Uses native fetch (Node 18+) -- no external dependencies.
 */

import type {
  BenchmarkClientConfig,
  BenchmarkTask,
  CreateTaskRequest,
  TaskSearchOptions,
  TaskListResult,
  BenchmarkRun,
  RecordRunRequest,
  RunSearchOptions,
  RunListResult,
  ROIQuery,
  ROIResult,
  CacheROIRequest,
  BenchmarkStats,
  PublishBenchmarkCampaignRequest,
  PublishBenchmarkCampaignResult,
} from './types.js';

export class BenchmarkClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: BenchmarkClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Tasks ────────────────────────────────────────────────────────────

  /**
   * Create a benchmark task from a closed GitHub issue.
   */
  async createTask(data: CreateTaskRequest): Promise<BenchmarkTask> {
    if (!data.source_repo) throw new Error('source_repo is required');
    if (!data.sanitized_prompt) throw new Error('sanitized_prompt is required');

    const res = await this.request('/api/v1/benchmark/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'create benchmark task');
    }

    return res.json();
  }

  /**
   * List benchmark tasks with optional filters.
   */
  async searchTasks(options?: TaskSearchOptions): Promise<TaskListResult> {
    const params = new URLSearchParams();
    if (options?.source_repo) params.set('source_repo', options.source_repo);
    if (options?.language) params.set('language', options.language);
    if (options?.issue_type) params.set('issue_type', options.issue_type);
    if (options?.complexity) params.set('complexity', options.complexity);
    if (options?.campaign_id) params.set('campaign_id', options.campaign_id);
    if (options?.limit != null) params.set('limit', String(options.limit));

    const qs = params.toString();
    const res = await this.request(`/api/v1/benchmark/tasks${qs ? '?' + qs : ''}`);

    if (!res.ok) {
      await this.throwFromResponse(res, 'search benchmark tasks');
    }

    return res.json();
  }

  // ── Runs ─────────────────────────────────────────────────────────────

  /**
   * Record a benchmark run result.
   *
   * Call this after executing a benchmark task against a model/config.
   * The quality_score and cost_metrics can be computed locally or
   * by the gateway.
   */
  async recordRun(data: RecordRunRequest): Promise<BenchmarkRun> {
    if (!data.task_id) throw new Error('task_id is required');
    if (!data.model) throw new Error('model is required');

    const res = await this.request('/api/v1/benchmark/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'record benchmark run');
    }

    return res.json();
  }

  /**
   * List benchmark runs with optional filters.
   */
  async searchRuns(options?: RunSearchOptions): Promise<RunListResult> {
    const params = new URLSearchParams();
    if (options?.task_id) params.set('task_id', options.task_id);
    if (options?.campaign_id) params.set('campaign_id', options.campaign_id);
    if (options?.model) params.set('model', options.model);
    if (options?.user_id) params.set('user_id', options.user_id);
    if (options?.repo) params.set('repo', options.repo);
    if (options?.limit != null) params.set('limit', String(options.limit));

    const qs = params.toString();
    const res = await this.request(`/api/v1/benchmark/runs${qs ? '?' + qs : ''}`);

    if (!res.ok) {
      await this.throwFromResponse(res, 'search benchmark runs');
    }

    return res.json();
  }

  // ── ROI ──────────────────────────────────────────────────────────────

  /**
   * Get ROI recommendations for a specific issue profile.
   *
   * Returns cached recommendations ranked by quality-adjusted cost
   * (lower is better). Supports filtering by issue type, language,
   * complexity, user, repo, and budget constraint.
   */
  async getROI(query?: ROIQuery): Promise<ROIResult> {
    const params = new URLSearchParams();
    if (query?.issue_type) params.set('issue_type', query.issue_type);
    if (query?.language) params.set('language', query.language);
    if (query?.complexity) params.set('complexity', query.complexity);
    if (query?.user_id) params.set('user_id', query.user_id);
    if (query?.repo) params.set('repo', query.repo);
    if (query?.budget_constraint != null) params.set('budget_constraint', String(query.budget_constraint));
    if (query?.top_k != null) params.set('top_k', String(query.top_k));

    const qs = params.toString();
    const res = await this.request(`/api/v1/benchmark/roi${qs ? '?' + qs : ''}`);

    if (!res.ok) {
      await this.throwFromResponse(res, 'get ROI recommendations');
    }

    return res.json();
  }

  /**
   * Cache ROI recommendations (computed externally by the ROI engine).
   *
   * Recommendations are cached with a 1-hour TTL in ScyllaDB.
   */
  async cacheROI(data: CacheROIRequest): Promise<{ success: boolean; cache_key: string; message: string }> {
    const res = await this.request('/api/v1/benchmark/roi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'cache ROI recommendations');
    }

    return res.json();
  }

  // ── Stats ────────────────────────────────────────────────────────────

  /**
   * Get aggregate benchmark statistics.
   *
   * Returns total task/run counts and per-config stats
   * (success rate, avg cost, avg quality).
   */
  async getStats(): Promise<BenchmarkStats> {
    const res = await this.request('/api/v1/benchmark/stats');

    if (!res.ok) {
      await this.throwFromResponse(res, 'get benchmark stats');
    }

    return res.json();
  }

  // ── Schema Init ──────────────────────────────────────────────────────

  /**
   * Initialize the benchmark schema (admin operation).
   *
   * Creates the ScyllaDB tables if they don't exist.
   */
  async initSchema(): Promise<{ success: boolean; message: string }> {
    const res = await this.request('/api/v1/benchmark/schema/init', {
      method: 'POST',
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'initialize benchmark schema');
    }

    return res.json();
  }

  /**
   * Publish a sanitized benchmark campaign into public_chain tables.
   */
  async publishCampaign(
    data: PublishBenchmarkCampaignRequest,
  ): Promise<PublishBenchmarkCampaignResult> {
    if (!data.campaign_id) throw new Error('campaign_id is required');
    if (!data.title) throw new Error('title is required');

    const res = await this.request('/api/v1/benchmark/campaigns/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'publish benchmark campaign');
    }

    return res.json();
  }

  // ── Helpers ──────────────────────────────────────────────────────────

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
