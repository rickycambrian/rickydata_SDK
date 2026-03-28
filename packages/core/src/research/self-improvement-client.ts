import type {
  BacktestSkillCandidateRequest,
  CreateResearchIssueRequest,
  CreateSkillCandidateRequest,
  DismissResearchIssueRequest,
  DraftResearchIssueRequest,
  IssueEscalation,
  PromoteSkillCandidateRequest,
  ResearchClientConfig,
  ResearchListIssuesOptions,
  SelfImprovementStatus,
  SkillCandidate,
  SkillCandidateListOptions,
  TriggerSelfImprovementRequest,
  WalletSkillRecord,
} from './types.js';

export class SelfImprovementClient {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(config: ResearchClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.token ?? config.apiKey ?? '';

    if (!this.baseUrl) throw new Error('baseUrl is required');
    if (!this.authToken) throw new Error('SelfImprovementClient requires either token or apiKey');
  }

  async getStatus(): Promise<SelfImprovementStatus> {
    const res = await this.request('/wallet/self-improvement/status');
    return this.parseJson(res, 'get self-improvement status');
  }

  async trigger(request: TriggerSelfImprovementRequest = {}): Promise<Record<string, unknown>> {
    const res = await this.request('/wallet/self-improvement/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'trigger self-improvement');
  }

  async listWalletSkills(): Promise<{ skills: WalletSkillRecord[]; total: number }> {
    const res = await this.request('/wallet/skills');
    return this.parseJson(res, 'list wallet skills');
  }

  async getWalletSkill(name: string): Promise<WalletSkillRecord> {
    if (!name) throw new Error('name is required');
    const res = await this.request(`/wallet/skills/${encodeURIComponent(name)}`);
    return this.parseJson(res, 'get wallet skill');
  }

  async upsertWalletSkill(name: string, content: string): Promise<Record<string, unknown>> {
    if (!name) throw new Error('name is required');
    if (!content) throw new Error('content is required');
    const res = await this.request(`/wallet/skills/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return this.parseJson(res, 'upsert wallet skill');
  }

  async deleteWalletSkill(name: string): Promise<Record<string, unknown>> {
    if (!name) throw new Error('name is required');
    const res = await this.request(`/wallet/skills/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    return this.parseJson(res, 'delete wallet skill');
  }

  async createSkillCandidate(request: CreateSkillCandidateRequest): Promise<SkillCandidate> {
    ensurePrivacyContext(request.privacyContext);
    const res = await this.request('/api/v1/research/skill-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'create skill candidate');
  }

  async listSkillCandidates(
    options: SkillCandidateListOptions = {},
  ): Promise<{ items: SkillCandidate[]; total: number }> {
    const res = await this.request(`/api/v1/research/skill-candidates${toQueryString(options)}`);
    return this.parseJson(res, 'list skill candidates');
  }

  async backtestSkillCandidate(
    candidateId: string,
    request: BacktestSkillCandidateRequest,
  ): Promise<SkillCandidate> {
    if (!candidateId) throw new Error('candidateId is required');
    const res = await this.request(`/api/v1/research/skill-candidates/${encodeURIComponent(candidateId)}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'backtest skill candidate');
  }

  async promoteSkillCandidate(
    candidateId: string,
    request: PromoteSkillCandidateRequest,
  ): Promise<SkillCandidate> {
    if (!candidateId) throw new Error('candidateId is required');
    const res = await this.request(`/api/v1/research/skill-candidates/${encodeURIComponent(candidateId)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson(res, 'promote skill candidate');
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

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
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
