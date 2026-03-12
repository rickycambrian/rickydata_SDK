import type {
  FeedbackOutcome,
  FeedbackSummary,
  FeedbackAccuracy,
  DriftAlert,
  RateRequest,
} from '../types.js';

export interface FeedbackApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
}

export class FeedbackApi {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;

  constructor(config: FeedbackApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.getToken = config.getToken;
  }

  async reportOutcome(executionId: string, outcome: { status: string; quality?: number }): Promise<void> {
    await this.request(`/api/feedback/outcome`, {
      method: 'POST',
      body: JSON.stringify({ executionId, ...outcome }),
    });
  }

  async rateExecution(executionId: string, rating: RateRequest): Promise<void> {
    await this.request(`/api/feedback/rate`, {
      method: 'POST',
      body: JSON.stringify({ executionId, ...rating }),
    });
  }

  async updateStatus(executionId: string, status: string): Promise<void> {
    await this.request(`/api/feedback/${executionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async getOutcome(executionId: string): Promise<FeedbackOutcome> {
    return this.request(`/api/feedback/${executionId}`);
  }

  async getSummary(): Promise<FeedbackSummary> {
    return this.request('/api/feedback/summary');
  }

  async getAccuracy(): Promise<FeedbackAccuracy> {
    return this.request('/api/feedback/accuracy');
  }

  async getDriftAlerts(): Promise<DriftAlert[]> {
    return this.request('/api/feedback/drift-alerts');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers as Record<string, string> || {}),
    };
    const res = await globalThis.fetch(url, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Feedback API error ${res.status}: ${body}`);
    }
    if (res.status === 204 || init?.method === 'PATCH') return undefined as T;
    return res.json();
  }
}
