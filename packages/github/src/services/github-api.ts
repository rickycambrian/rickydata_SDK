import type {
  GitHubInstallation,
  GitHubIssue,
  InstallationPolicy,
  InstallationTriggers,
  PaginatedResponse,
  ListOptions,
  WorkSession,
  PullRequest,
  ReviewRun,
  ReviewRunEvent,
  VerificationStatus,
  TeamReviewRun,
  TeamReviewRunEvent,
  TeamReviewConfig,
  GitHubRepoSettings,
  DeriveGitHubRepoSessionChallengeInput,
  GitHubRepoSessionChallenge,
  CreateGitHubRepoSessionInput,
  GitHubRepoSession,
  GitHubRepoSessionTree,
  GitHubRepoSessionChatRequest,
} from '../types.js';
import type { SSEEvent } from 'rickydata/agent';

export interface GitHubApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
}

export interface CreateReviewRunInput {
  repo: string;
  prNumber: number;
  model?: string;
  async?: boolean;
  verificationStatus?: VerificationStatus;
  verificationNote?: string;
  plannedLikelihood?: {
    expectedSuccess?: number;
    expectedCost?: number;
    confidenceLower?: number;
    confidenceUpper?: number;
    model?: string;
  };
}

export interface CreateTeamReviewRunInput extends CreateReviewRunInput {
  teamReview: true;
  teamConfig?: TeamReviewConfig;
}

export class GitHubApi {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;

  constructor(config: GitHubApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.getToken = config.getToken;
  }

  // Installations
  async listInstallations(): Promise<GitHubInstallation[]> {
    return this.request('/github/installations');
  }

  async registerInstallation(installationId: string, repos: string[]): Promise<GitHubInstallation> {
    return this.request('/github/installations', {
      method: 'POST',
      body: JSON.stringify({ installationId, repos }),
    });
  }

  async updatePolicy(installationId: string, policy: Partial<InstallationPolicy>): Promise<GitHubInstallation> {
    return this.request(`/github/installations/${installationId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ policy }),
    });
  }

  async updateTriggers(installationId: string, triggers: Partial<InstallationTriggers>): Promise<GitHubInstallation> {
    return this.request(`/github/installations/${installationId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ triggers }),
    });
  }

  async setTrustTier(installationId: string, tier: GitHubInstallation['trustTier']): Promise<GitHubInstallation> {
    return this.request(`/github/installations/${installationId}/trust-tier`, {
      method: 'PUT',
      body: JSON.stringify({ tier }),
    });
  }

  async toggleKillSwitch(installationId: string, enabled: boolean): Promise<GitHubInstallation> {
    return this.request(`/github/installations/${installationId}/kill-switch`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  async getInstallationStats(installationId: string): Promise<GitHubInstallation['stats']> {
    return this.request(`/github/installations/${installationId}/stats`);
  }

  // Issues
  async listIssues(
    owner: string,
    repo: string,
    opts?: ListOptions & { state?: 'open' | 'closed' | 'all'; labels?: string }
  ): Promise<PaginatedResponse<GitHubIssue>> {
    const params = new URLSearchParams();
    if (opts?.state) params.set('state', opts.state);
    if (opts?.labels) params.set('labels', opts.labels);
    if (opts?.page) params.set('page', String(opts.page));
    if (opts?.pageSize) params.set('per_page', String(opts.pageSize));
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.order) params.set('order', opts.order);
    const qs = params.toString();
    return this.request(`/github/repos/${owner}/${repo}/issues${qs ? `?${qs}` : ''}`);
  }

  // Work sessions
  async startSession(issueId: string): Promise<WorkSession> {
    return this.request(`/github/issues/${issueId}/start-session`, { method: 'POST' });
  }

  async createPR(sessionId: string): Promise<PullRequest> {
    return this.request(`/github/sessions/${sessionId}/create-pr`, { method: 'POST' });
  }

  async syncPR(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    return this.request(`/github/prs/${prNumber}/sync`, {
      method: 'POST',
      body: JSON.stringify({ owner, repo }),
    });
  }

  // Review run lifecycle
  async createReviewRun(input: CreateReviewRunInput): Promise<ReviewRun> {
    const payload = await this.request<{ run: ReviewRun }>('/api/v1/reviews/runs', {
      method: 'POST',
      body: JSON.stringify({ ...input, async: input.async ?? true }),
    });
    return payload.run;
  }

  async listReviewRuns(filters?: {
    repo?: string;
    prNumber?: number;
    status?: ReviewRun['status'];
    limit?: number;
  }): Promise<ReviewRun[]> {
    const params = new URLSearchParams();
    if (filters?.repo) params.set('repo', filters.repo);
    if (filters?.prNumber) params.set('prNumber', String(filters.prNumber));
    if (filters?.status) params.set('status', filters.status);
    if (filters?.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const payload = await this.request<{ runs?: ReviewRun[] }>(`/api/v1/reviews/runs${qs ? `?${qs}` : ''}`);
    return payload.runs ?? [];
  }

  async getReviewRun(runId: string): Promise<ReviewRun> {
    const payload = await this.request<{ run: ReviewRun }>(`/api/v1/reviews/runs/${encodeURIComponent(runId)}`);
    return payload.run;
  }

  async generateReviewDraft(
    runId: string,
    input?: { verificationStatus?: VerificationStatus; verificationNote?: string },
  ): Promise<ReviewRun> {
    const payload = await this.request<{ run: ReviewRun }>(
      `/api/v1/reviews/runs/${encodeURIComponent(runId)}/generate`,
      {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      },
    );
    return payload.run;
  }

  async postReviewRun(
    runId: string,
    input?: { verificationStatus?: VerificationStatus; verificationNote?: string },
  ): Promise<ReviewRun> {
    const payload = await this.request<{ run: ReviewRun }>(
      `/api/v1/reviews/runs/${encodeURIComponent(runId)}/post`,
      {
        method: 'POST',
        body: JSON.stringify(input ?? {}),
      },
    );
    return payload.run;
  }

  async listReviewRunEvents(
    runId: string,
    filters?: { after?: number; limit?: number },
  ): Promise<ReviewRunEvent[]> {
    const params = new URLSearchParams();
    if (filters?.after) params.set('after', String(filters.after));
    if (filters?.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    const payload = await this.request<{ events?: ReviewRunEvent[] }>(
      `/api/v1/reviews/runs/${encodeURIComponent(runId)}/events${qs ? `?${qs}` : ''}`,
    );
    return payload.events ?? [];
  }

  async *streamReviewRunEvents(
    runId: string,
    options?: { after?: number; signal?: AbortSignal },
  ): AsyncGenerator<ReviewRunEvent> {
    const token = await this.getToken();
    const params = new URLSearchParams();
    if (options?.after) params.set('after', String(options.after));
    const qs = params.toString();
    const url = `${this.baseUrl}/api/v1/reviews/runs/${encodeURIComponent(runId)}/events${qs ? `?${qs}` : ''}`;
    const res = await globalThis.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: options?.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const lineRaw of lines) {
        const line = lineRaw.trimEnd();
        if (!line) {
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n');
            dataLines = [];
            try {
              yield JSON.parse(payload) as ReviewRunEvent;
            } catch {
              // Skip malformed frames.
            }
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }
    }
  }

  // Team review lifecycle
  async createTeamReviewRun(input: CreateTeamReviewRunInput): Promise<TeamReviewRun> {
    const payload = await this.request<{ run: TeamReviewRun }>('/api/v1/reviews/runs', {
      method: 'POST',
      body: JSON.stringify({ ...input, async: true, teamReview: true }),
    });
    return payload.run;
  }

  async getTeamReviewRun(runId: string): Promise<TeamReviewRun> {
    const payload = await this.request<{ run: TeamReviewRun }>(
      `/api/v1/reviews/runs/${encodeURIComponent(runId)}`,
    );
    return payload.run;
  }

  async *streamTeamReviewEvents(
    runId: string,
    options?: { after?: number; signal?: AbortSignal },
  ): AsyncGenerator<TeamReviewRunEvent> {
    const token = await this.getToken();
    const params = new URLSearchParams();
    if (options?.after) params.set('after', String(options.after));
    const qs = params.toString();
    const url = `${this.baseUrl}/api/v1/reviews/runs/${encodeURIComponent(runId)}/events${qs ? `?${qs}` : ''}`;
    const res = await globalThis.fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: options?.signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const lineRaw of lines) {
        const line = lineRaw.trimEnd();
        if (!line) {
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n');
            dataLines = [];
            try {
              yield JSON.parse(payload) as TeamReviewRunEvent;
            } catch {
              // Skip malformed frames.
            }
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }
    }
  }

  async getReviewMd(owner: string, repo: string): Promise<string | null> {
    try {
      const payload = await this.request<{ content: string }>(
        `/github/repos/${owner}/${repo}/review-md`,
      );
      return payload.content;
    } catch {
      return null;
    }
  }

  // Ephemeral repo development sessions
  async getRepoSettings(owner: string, repo: string): Promise<GitHubRepoSettings> {
    return this.request(`/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/settings`);
  }

  async updateRepoSettings(
    owner: string,
    repo: string,
    settings: Partial<GitHubRepoSettings>,
  ): Promise<GitHubRepoSettings> {
    return this.request(`/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async deriveRepoSessionChallenge(
    owner: string,
    repo: string,
    input: DeriveGitHubRepoSessionChallengeInput = {},
  ): Promise<GitHubRepoSessionChallenge> {
    return this.request(
      `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sessions/derive-challenge`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
  }

  async createRepoSession(
    owner: string,
    repo: string,
    input: CreateGitHubRepoSessionInput,
  ): Promise<GitHubRepoSession> {
    return this.request(`/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/sessions`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async deleteRepoSession(sessionId: string): Promise<void> {
    await this.requestEmpty(`/github/repo-sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  }

  async getRepoSessionTree(
    sessionId: string,
    options?: { path?: string; ref?: string },
  ): Promise<GitHubRepoSessionTree> {
    const params = new URLSearchParams();
    if (options?.path) params.set('path', options.path);
    if (options?.ref) params.set('ref', options.ref);
    const qs = params.toString();
    return this.request(`/github/repo-sessions/${encodeURIComponent(sessionId)}/tree${qs ? `?${qs}` : ''}`);
  }

  async *streamRepoSessionChat(
    sessionId: string,
    input: GitHubRepoSessionChatRequest,
    options?: { signal?: AbortSignal },
  ): AsyncGenerator<SSEEvent> {
    yield* this.streamSSE<SSEEvent>(`/github/repo-sessions/${encodeURIComponent(sessionId)}/chat`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options?.signal,
    });
  }

  // Private helpers
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
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }
    return res.json();
  }

  private async requestEmpty(path: string, init?: RequestInit): Promise<void> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init?.headers as Record<string, string>) || {}),
    };
    const res = await globalThis.fetch(url, { ...init, headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }
  }

  private async *streamSSE<T>(path: string, init: RequestInit): AsyncGenerator<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) || {}),
    };
    const res = await globalThis.fetch(url, { ...init, headers });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = '';
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const lineRaw of lines) {
        const line = lineRaw.trimEnd();
        if (!line) {
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n');
            dataLines = [];
            try {
              yield JSON.parse(payload) as T;
            } catch {
              // Skip malformed frames.
            }
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
        }
      }
    }
  }
}
