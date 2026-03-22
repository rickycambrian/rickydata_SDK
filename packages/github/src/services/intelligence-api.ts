import type {
  CommitAnalysis,
  LabelSuggestion,
  IssueRelationship,
  StateContext,
  TriageResult,
} from '../types.js';

export interface IntelligenceApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
}

export class IntelligenceApi {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;

  constructor(config: IntelligenceApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.getToken = config.getToken;
  }

  async analyzeCommits(repo: string, limit?: number): Promise<CommitAnalysis> {
    return this.request('/api/v1/issues/analyze-commits', {
      method: 'POST',
      body: JSON.stringify({ repo, ...(limit != null ? { limit } : {}) }),
    });
  }

  async suggestLabels(repo: string, issueNumber: number): Promise<LabelSuggestion[]> {
    return this.request('/api/v1/issues/suggest-labels', {
      method: 'POST',
      body: JSON.stringify({ repo, issueNumber }),
    });
  }

  async detectRelationships(repo: string): Promise<IssueRelationship[]> {
    return this.request('/api/v1/issues/detect-relationships', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    });
  }

  async buildContext(repo: string, issueNumber: number): Promise<StateContext> {
    return this.request('/api/v1/issues/build-context', {
      method: 'POST',
      body: JSON.stringify({ repo, issueNumber }),
    });
  }

  async triage(repo: string, issueNumber: number): Promise<TriageResult> {
    return this.request('/api/v1/issues/triage', {
      method: 'POST',
      body: JSON.stringify({ repo, issueNumber }),
    });
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
      throw new Error(`Intelligence API error ${res.status}: ${body}`);
    }
    return res.json();
  }
}
