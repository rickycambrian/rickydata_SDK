export interface BenchmarkEvidenceClientConfig {
  baseUrl?: string;
  agentGatewayUrl?: string;
  token?: string;
  apiKey?: string;
}

export interface ListLiveRunsOptions {
  repo: string;
  campaignId?: string;
  config?: string;
  limit?: number;
}

export interface GetRunHistoryOptions {
  repo: string;
  campaignId?: string;
  issueNumber?: number;
  config?: string;
  limit?: number;
}

export interface ExecuteProofBackedRunRequest {
  repo: string;
  issue_number: number;
  task_id?: string;
  campaign_id: string;
  config: string;
  visibility: 'public' | 'private';
  data_scope: 'public_repo' | 'private_wallet';
  write_scope: 'public_benchmark_graph' | 'private_wallet_graph';
  proof_required: boolean;
  trace_required: boolean;
  timeout_ms?: number;
  inactivity_timeout_ms?: number;
  max_turns?: number;
  metadata?: Record<string, unknown>;
  run_configuration?: Record<string, unknown>;
}

export type BenchmarkLiveRunRow = Record<string, unknown>;
export type BenchmarkTraceReadModel = Record<string, unknown>;
export type BenchmarkConfigRecord = Record<string, unknown>;
export type ProofBackedRunResult = Record<string, unknown>;

export class BenchmarkEvidenceClient {
  private readonly baseUrl: string;
  private readonly agentGatewayUrl: string;
  private readonly authToken: string;

  constructor(config: BenchmarkEvidenceClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? 'https://benchmarks.rickydata.org').replace(/\/$/, '');
    this.agentGatewayUrl = (config.agentGatewayUrl ?? 'https://agents.rickydata.org').replace(/\/$/, '');
    this.authToken = config.token ?? config.apiKey ?? '';

    if (!this.baseUrl) throw new Error('baseUrl is required');
    if (!this.agentGatewayUrl) throw new Error('agentGatewayUrl is required');
  }

  async listLiveRuns(options: ListLiveRunsOptions): Promise<{ rows: BenchmarkLiveRunRow[]; total?: number }> {
    if (!options.repo) throw new Error('repo is required');
    const params: Record<string, string | number | undefined> = {
      repo: options.repo,
      campaign_id: options.campaignId ?? 'benchmark_matrix_current',
      limit: options.limit,
    };
    const payload = await this.getJson<{ rows?: BenchmarkLiveRunRow[]; total?: number }>(
      `${this.baseUrl}/api/benchmarks/live${toQueryString(params)}`,
      'list live benchmark runs',
    );
    const rows = payload.rows ?? [];
    return {
      ...payload,
      rows: options.config ? rows.filter((row) => rowConfigId(row) === options.config) : rows,
    };
  }

  async getRunHistory(options: GetRunHistoryOptions): Promise<{ rows: BenchmarkLiveRunRow[]; total?: number }> {
    if (!options.repo) throw new Error('repo is required');
    const params: Record<string, string | number | undefined> = {
      repo: options.repo,
      campaign_id: options.campaignId ?? 'benchmark_matrix_current',
      issue_number: options.issueNumber,
      config: options.config,
      limit: options.limit,
    };
    const payload = await this.getJson<{ rows?: BenchmarkLiveRunRow[]; total?: number }>(
      `${this.baseUrl}/api/benchmarks/runs/history${toQueryString(params)}`,
      'get benchmark run history',
    );
    return { ...payload, rows: payload.rows ?? [] };
  }

  async getTraceReadModel(traceKgRef: string): Promise<BenchmarkTraceReadModel> {
    if (!traceKgRef) throw new Error('traceKgRef is required');
    return this.getJson<BenchmarkTraceReadModel>(
      `${this.baseUrl}/api/benchmarks/traces/${encodeURIComponent(traceKgRef)}`,
      'get benchmark trace read model',
    );
  }

  async getBenchmarkConfigs(): Promise<{ configs: BenchmarkConfigRecord[] }> {
    const payload = await this.getJson<{ configs?: BenchmarkConfigRecord[] }>(
      `${this.baseUrl}/api/benchmarks/configs`,
      'get benchmark configs',
    );
    return { ...payload, configs: payload.configs ?? [] };
  }

  async executeProofBackedRun(request: ExecuteProofBackedRunRequest): Promise<ProofBackedRunResult> {
    if (!this.authToken) throw new Error('executeProofBackedRun requires token or apiKey');
    if (!request.repo) throw new Error('repo is required');
    if (!request.issue_number) throw new Error('issue_number is required');
    if (!request.campaign_id) throw new Error('campaign_id is required');
    if (!request.config) throw new Error('config is required');
    return this.postJson<ProofBackedRunResult>(
      `${this.agentGatewayUrl}/api/benchmark/runs/execute-proof-backed`,
      request,
      'execute proof-backed benchmark run',
    );
  }

  private async getJson<T>(url: string, action: string): Promise<T> {
    const res = await globalThis.fetch(url, {
      headers: this.headers(),
    });
    return parseJson<T>(res, action);
  }

  private async postJson<T>(url: string, body: unknown, action: string): Promise<T> {
    const headers = this.headers();
    headers.set('Content-Type', 'application/json');
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return parseJson<T>(res, action);
  }

  private headers(): Headers {
    const headers = new Headers({ Accept: 'application/json' });
    if (this.authToken) headers.set('Authorization', `Bearer ${this.authToken}`);
    return headers;
  }
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

function rowConfigId(row: BenchmarkLiveRunRow): string {
  return String(row.config_id ?? row.configId ?? row.config ?? '');
}

async function parseJson<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to ${action}: ${res.status}${body ? ` ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}
