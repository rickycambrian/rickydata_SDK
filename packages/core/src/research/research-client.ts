import {
  createDefaultResearchPolicyArms,
  DEFAULT_RESEARCH_AGENT_SPECS,
  DEFAULT_RESEARCH_MODEL,
  DEFAULT_RESEARCH_PROVIDER,
} from './defaults.js';
import type {
  AppendResearchRunEventRequest,
  CreateResearchIssueRequest,
  CreateResearchRunRequest,
  DismissResearchIssueRequest,
  DraftResearchIssueRequest,
  IssueEscalation,
  PromoteResearchRunRequest,
  ResearchClientConfig,
  ResearchListIssuesOptions,
  ResearchListRunsOptions,
  ResearchRun,
  ResearchRunEvent,
  VerifyResearchRunRequest,
} from './types.js';

export class ResearchClient {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(config: ResearchClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.token ?? config.apiKey ?? '';

    if (!this.baseUrl) throw new Error('baseUrl is required');
    if (!this.authToken) throw new Error('ResearchClient requires either token or apiKey');
  }

  async createRun(request: CreateResearchRunRequest): Promise<ResearchRun> {
    ensurePrivacyContext(request.privacyContext);
    const res = await this.request('/api/v1/research/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...request,
        provider: request.provider ?? DEFAULT_RESEARCH_PROVIDER,
        model: request.model ?? DEFAULT_RESEARCH_MODEL,
        agentSpecs: request.agentSpecs ?? DEFAULT_RESEARCH_AGENT_SPECS,
        policyArms: request.policyArms ?? createDefaultResearchPolicyArms(request.privacyContext),
      }),
    });
    return this.parseJson<ResearchRun>(res, 'create research run');
  }

  async listRuns(options: ResearchListRunsOptions = {}): Promise<{ items: ResearchRun[]; total: number }> {
    const res = await this.request(`/api/v1/research/runs${toQueryString(options)}`);
    return this.parseJson(res, 'list research runs');
  }

  async getRun(runId: string): Promise<ResearchRun> {
    if (!runId) throw new Error('runId is required');
    const res = await this.request(`/api/v1/research/runs/${encodeURIComponent(runId)}`);
    return this.parseJson(res, 'get research run');
  }

  async getRunEvents(runId: string): Promise<{ items: ResearchRunEvent[]; total: number }> {
    if (!runId) throw new Error('runId is required');
    const res = await this.request(`/api/v1/research/runs/${encodeURIComponent(runId)}/events`);
    return this.parseJson(res, 'get research run events');
  }

  async appendRunEvent(runId: string, request: AppendResearchRunEventRequest): Promise<ResearchRunEvent> {
    if (!runId) throw new Error('runId is required');
    const res = await this.request(`/api/v1/research/runs/${encodeURIComponent(runId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'append research run event');
  }

  async verifyRun(runId: string, request: VerifyResearchRunRequest): Promise<ResearchRun> {
    if (!runId) throw new Error('runId is required');
    const res = await this.request(`/api/v1/research/runs/${encodeURIComponent(runId)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'verify research run');
  }

  async promoteRun(runId: string, request: PromoteResearchRunRequest): Promise<ResearchRun> {
    if (!runId) throw new Error('runId is required');
    const res = await this.request(`/api/v1/research/runs/${encodeURIComponent(runId)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'promote research run');
  }

  async draftIssue(request: DraftResearchIssueRequest): Promise<IssueEscalation> {
    ensurePrivacyContext(request.privacyContext);
    const res = await this.request('/api/v1/research/issues/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'draft research issue');
  }

  async listIssues(options: ResearchListIssuesOptions = {}): Promise<{ items: IssueEscalation[]; total: number }> {
    const res = await this.request(`/api/v1/research/issues${toQueryString(options)}`);
    return this.parseJson(res, 'list research issues');
  }

  async createIssue(issueId: string, request: CreateResearchIssueRequest = {}): Promise<IssueEscalation> {
    if (!issueId) throw new Error('issueId is required');
    const res = await this.request(`/api/v1/research/issues/${encodeURIComponent(issueId)}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'create research issue');
  }

  async dismissIssue(issueId: string, request: DismissResearchIssueRequest = {}): Promise<IssueEscalation> {
    if (!issueId) throw new Error('issueId is required');
    const res = await this.request(`/api/v1/research/issues/${encodeURIComponent(issueId)}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'dismiss research issue');
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers ?? {});
    headers.set('Authorization', `Bearer ${this.authToken}`);

    return globalThis.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to ${action}: ${res.status}${body ? ` ${body}` : ''}`);
    }
    return res.json() as Promise<T>;
  }
}

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function ensurePrivacyContext(context: { projectId?: string; workspaceId?: string; visibility?: string; readScope?: string }): void {
  if (!context.projectId) throw new Error('privacyContext.projectId is required');
  if (!context.workspaceId) throw new Error('privacyContext.workspaceId is required');
  if (context.visibility !== 'private') throw new Error('privacyContext.visibility must be "private"');
  if (context.readScope !== 'private') throw new Error('privacyContext.readScope must be "private"');
}
