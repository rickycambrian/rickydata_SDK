import type {
  KfdbBatchGetEntitiesRequest,
  KfdbBatchGetEntitiesResponse,
  KfdbClientConfig,
  KfdbEntityResponse,
  KfdbFilterEntitiesRequest,
  KfdbGetEntityOptions,
  KfdbListEntitiesOptions,
  KfdbListEntitiesResponse,
  KfdbListLabelsResponse,
  KfdbQueryScope,
  KfdbWriteRequest,
  KfdbWriteResponse,
} from './types.js';

export class KFDBClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly apiKey?: string;
  private readonly defaultReadScope: KfdbQueryScope;

  constructor(config: KfdbClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.apiKey = config.apiKey;
    this.defaultReadScope = config.defaultReadScope ?? 'global';

    if (!this.token && !this.apiKey) {
      throw new Error('KFDBClient requires either token or apiKey');
    }
  }

  withScope(scope: KfdbQueryScope): KFDBClient {
    return new KFDBClient({
      baseUrl: this.baseUrl,
      token: this.token,
      apiKey: this.apiKey,
      defaultReadScope: scope,
    });
  }

  async listLabels(scope?: KfdbQueryScope): Promise<KfdbListLabelsResponse> {
    const resolvedScope = this.resolveScope(scope);
    const res = await this.request(`/api/v1/entities/labels?scope=${resolvedScope}`);
    return this.parseJson<KfdbListLabelsResponse>(res, 'list labels');
  }

  async listEntities(label: string, options: KfdbListEntitiesOptions = {}): Promise<KfdbListEntitiesResponse> {
    const params = new URLSearchParams();
    params.set('scope', this.resolveScope(options.scope));
    if (options.limit != null) params.set('limit', String(options.limit));
    if (options.offset != null) params.set('offset', String(options.offset));
    if (options.sortBy) params.set('sort_by', options.sortBy);
    if (options.sortOrder) params.set('sort_order', options.sortOrder);
    if (options.includeEmbeddings != null) params.set('include_embeddings', String(options.includeEmbeddings));

    const encodedLabel = encodeURIComponent(label);
    const res = await this.request(`/api/v1/entities/${encodedLabel}?${params.toString()}`);
    return this.parseJson<KfdbListEntitiesResponse>(res, 'list entities');
  }

  async getEntity(label: string, id: string, options: KfdbGetEntityOptions = {}): Promise<KfdbEntityResponse> {
    const params = new URLSearchParams();
    params.set('scope', this.resolveScope(options.scope));
    if (options.includeEmbeddings != null) params.set('include_embeddings', String(options.includeEmbeddings));

    const encodedLabel = encodeURIComponent(label);
    const encodedId = encodeURIComponent(id);
    const res = await this.request(`/api/v1/entities/${encodedLabel}/${encodedId}?${params.toString()}`);
    return this.parseJson<KfdbEntityResponse>(res, 'get entity');
  }

  async filterEntities(label: string, request: KfdbFilterEntitiesRequest): Promise<KfdbListEntitiesResponse> {
    const encodedLabel = encodeURIComponent(label);
    const payload = {
      scope: this.resolveScope(request.scope),
      filters: request.filters ?? {},
      limit: request.limit,
      offset: request.offset,
      sort_by: request.sortBy,
      sort_order: request.sortOrder,
      include_embeddings: request.includeEmbeddings,
    };

    const res = await this.request(`/api/v1/entities/${encodedLabel}/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.parseJson<KfdbListEntitiesResponse>(res, 'filter entities');
  }

  async batchGetEntities(request: KfdbBatchGetEntitiesRequest): Promise<KfdbBatchGetEntitiesResponse> {
    const payload = {
      scope: this.resolveScope(request.scope),
      entities: request.entities,
      include_embeddings: request.includeEmbeddings,
    };

    const res = await this.request('/api/v1/entities/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.parseJson<KfdbBatchGetEntitiesResponse>(res, 'batch get entities');
  }

  async write(request: KfdbWriteRequest): Promise<KfdbWriteResponse> {
    const res = await this.request('/api/v1/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return this.parseJson<KfdbWriteResponse>(res, 'write');
  }

  private resolveScope(scope?: KfdbQueryScope): KfdbQueryScope {
    return scope ?? this.defaultReadScope;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const token = this.token ?? this.apiKey;
    if (!token) {
      throw new Error('No auth token available for KFDB request');
    }

    const headers = new Headers(init?.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);

    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Failed to ${action}: ${res.status}${errorBody ? ` ${errorBody}` : ''}`);
    }
    return res.json() as Promise<T>;
  }
}
