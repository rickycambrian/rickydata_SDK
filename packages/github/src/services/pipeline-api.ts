import type {
  PipelineResolveRequest,
  PipelineResolveResponse,
  PipelineStatus,
  PipelineProposeRequest,
  PipelineProposeResponse,
  PendingPlan,
  PlanApproveRequest,
} from '../types.js';

export interface PipelineApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
}

export class PipelineApi {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;

  constructor(config: PipelineApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.getToken = config.getToken;
  }

  async resolve(req: PipelineResolveRequest): Promise<PipelineResolveResponse> {
    return this.request('/api/v1/pipeline/resolve', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  async getStatus(): Promise<PipelineStatus> {
    return this.request('/api/v1/pipeline/status');
  }

  async propose(req: PipelineProposeRequest): Promise<PipelineProposeResponse> {
    return this.request('/api/v1/pipeline/propose', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  async approvePlan(runId: string, opts?: PlanApproveRequest): Promise<PipelineResolveResponse> {
    return this.request(`/api/v1/pipeline/plans/${runId}/approve`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    });
  }

  async rejectPlan(runId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/v1/pipeline/plans/${runId}/reject`, {
      method: 'POST',
    });
  }

  async addPlanFeedback(runId: string, feedback: string): Promise<PipelineProposeResponse> {
    return this.request(`/api/v1/pipeline/plans/${runId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    });
  }

  async listPlans(): Promise<PendingPlan[]> {
    return this.request('/api/v1/pipeline/plans');
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
      throw new Error(`Pipeline API error ${res.status}: ${body}`);
    }
    return res.json();
  }
}
