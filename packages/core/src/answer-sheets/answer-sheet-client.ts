/**
 * Answer Sheet Client
 *
 * Client for managing answer sheets -- proven solution patterns mined from
 * successful agent sessions. Communicates with the KFDB REST API.
 *
 * Uses native fetch (Node 18+) -- no external dependencies.
 */

import type {
  AnswerSheet,
  AnswerSheetClientConfig,
  AnswerSheetSearchOptions,
  AnswerSheetSearchResult,
  CreateAnswerSheetRequest,
  CreateAnswerSheetResponse,
  UpdateAnswerSheetRequest,
  MatchAnswerSheetRequest,
  MatchContext,
  MatchAnswerSheetResult,
  AnswerSheetFeedbackRequest,
  AnswerSheetFeedbackResult,
} from './types.js';

export class AnswerSheetClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AnswerSheetClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Search / List ──────────────────────────────────────────────────────

  /**
   * List answer sheets with optional filters.
   *
   * Results are sorted by confidence (descending).
   */
  async search(options?: AnswerSheetSearchOptions): Promise<AnswerSheetSearchResult> {
    const params = new URLSearchParams();
    if (options?.problem_category) params.set('problem_category', options.problem_category);
    if (options?.language) params.set('language', options.language);
    if (options?.tag) params.set('tag', options.tag);
    if (options?.min_confidence != null) params.set('min_confidence', String(options.min_confidence));
    if (options?.is_public != null) params.set('is_public', String(options.is_public));
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));

    const qs = params.toString();
    const res = await this.request(`/api/v1/answer-sheets${qs ? '?' + qs : ''}`);

    if (!res.ok) {
      await this.throwFromResponse(res, 'search answer sheets');
    }

    return res.json();
  }

  // ── Get by ID ──────────────────────────────────────────────────────────

  /**
   * Get a specific answer sheet by ID.
   */
  async get(id: string): Promise<AnswerSheet> {
    if (!id) throw new Error('answer_sheet_id is required');

    const res = await this.request(`/api/v1/answer-sheets/${encodeURIComponent(id)}`);

    if (!res.ok) {
      await this.throwFromResponse(res, 'get answer sheet');
    }

    return res.json();
  }

  // ── Create ─────────────────────────────────────────────────────────────

  /**
   * Create a new answer sheet with solution steps.
   *
   * Returns a slim response with the new ID and initial confidence.
   * The confidence starts at 0 / (0 + 0 + 5) = 0.0 until feedback is received.
   */
  async create(data: CreateAnswerSheetRequest): Promise<CreateAnswerSheetResponse> {
    if (!data.error_signature) throw new Error('error_signature is required');
    if (!data.problem_category) throw new Error('problem_category is required');
    if (!data.solution_steps || data.solution_steps.length === 0) {
      throw new Error('solution_steps must have at least one step');
    }
    if (!data.solution_summary) throw new Error('solution_summary is required');

    const res = await this.request('/api/v1/answer-sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'create answer sheet');
    }

    return res.json();
  }

  // ── Update ─────────────────────────────────────────────────────────────

  /**
   * Update an existing answer sheet (partial update).
   *
   * Returns the full updated answer sheet.
   */
  async update(id: string, data: UpdateAnswerSheetRequest): Promise<AnswerSheet> {
    if (!id) throw new Error('answer_sheet_id is required');

    const res = await this.request(`/api/v1/answer-sheets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'update answer sheet');
    }

    return res.json();
  }

  // ── Match ──────────────────────────────────────────────────────────────

  /**
   * Find answer sheets that match a given error message or context.
   *
   * Returns matches ranked by a combination of match score and confidence.
   * Uses both error signature regex matching and fuzzy text similarity.
   */
  async match(errorText: string, context?: MatchContext): Promise<MatchAnswerSheetResult> {
    if (!errorText) throw new Error('errorText is required');

    const body: MatchAnswerSheetRequest = {
      error_text: errorText,
      context,
    };

    const res = await this.request('/api/v1/answer-sheets/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'match answer sheets');
    }

    return res.json();
  }

  // ── Feedback ───────────────────────────────────────────────────────────

  /**
   * Submit feedback on an answer sheet to update its Bayesian confidence.
   *
   * - positive=true: The answer sheet solved the problem (+1 success)
   * - positive=false: The answer sheet did not work (+1 failure)
   *
   * Confidence formula: success / (success + failure + 5)
   */
  async feedback(
    id: string,
    positive: boolean,
    options?: { context?: string; session_id?: string },
  ): Promise<AnswerSheetFeedbackResult> {
    if (!id) throw new Error('answer_sheet_id is required');

    const body: AnswerSheetFeedbackRequest = {
      positive,
      context: options?.context,
      session_id: options?.session_id,
    };

    const res = await this.request(`/api/v1/answer-sheets/${encodeURIComponent(id)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'submit answer sheet feedback');
    }

    return res.json();
  }

  // ── Schema Init ────────────────────────────────────────────────────────

  /**
   * Initialize the answer sheet schema (admin operation).
   *
   * Creates the ScyllaDB tables if they don't exist.
   */
  async initSchema(): Promise<{ success: boolean; message: string }> {
    const res = await this.request('/api/v1/answer-sheets/schema/init', {
      method: 'POST',
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'initialize answer sheet schema');
    }

    return res.json();
  }

  // ── Helpers ────────────────────────────────────────────────────────────

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
