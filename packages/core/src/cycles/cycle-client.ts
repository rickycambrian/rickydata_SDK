/**
 * Cycle Client
 *
 * Client for the autonomous loop cycle tracking system. Ingests cycle results,
 * lists historical cycles, and retrieves aggregate summaries for monitoring
 * autonomous system performance.
 *
 * Uses native fetch (Node 18+) for all requests.
 */

import type {
  CycleClientConfig,
  CycleListResponse,
  CycleSummaryResponse,
  IngestCycleRequest,
  IngestCycleResponse,
} from './types.js';

export class CycleClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: CycleClientConfig) {
    if (!config.baseUrl) throw new Error('baseUrl is required');
    if (!config.apiKey) throw new Error('apiKey is required');

    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Ingest ──────────────────────────────────────────────────────────────────

  /**
   * Record a completed autonomous cycle.
   *
   * Submits the results of one full scan-resolve-PR iteration for tracking.
   */
  async ingest(data: IngestCycleRequest): Promise<IngestCycleResponse> {
    if (!data.cycle_id) throw new Error('cycle_id is required');

    const res = await this.request('/api/v1/cycles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'ingest cycle');
    }

    return res.json();
  }

  // ── List ────────────────────────────────────────────────────────────────────

  /**
   * List all recorded cycles.
   */
  async list(): Promise<CycleListResponse> {
    const res = await this.request('/api/v1/cycles');

    if (!res.ok) {
      await this.throwFromResponse(res, 'list cycles');
    }

    return res.json();
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  /**
   * Get aggregate summary statistics across all cycles.
   */
  async getSummary(): Promise<CycleSummaryResponse> {
    const res = await this.request('/api/v1/cycles/summary');

    if (!res.ok) {
      await this.throwFromResponse(res, 'get cycle summary');
    }

    return res.json();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

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
