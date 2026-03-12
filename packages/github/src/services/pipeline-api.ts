import type {
  PipelineResolveRequest,
  PipelineResolveResponse,
  PipelineStatus,
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
