import type { KFDBClient } from './client.js';
import type {
  KfdbBatchGetEntitiesRequest,
  KfdbBatchGetEntitiesResponse,
  KfdbEntityResponse,
  KfdbGetEntityOptions,
  KfdbListEntitiesOptions,
  KfdbListEntitiesResponse,
  KfdbReadSessionOptions,
} from './types.js';

const BATCH_LIMIT = 100;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && !(item instanceof AbortSignal))
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Request-scoped KFDB read plan. Equal reads share one promise, including after
 * resolution, but no cache crosses the explicit session boundary.
 */
export class KfdbReadSession {
  private readonly reads = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: KFDBClient,
    private readonly defaults: KfdbReadSessionOptions = {},
  ) {}

  clear(): void {
    this.reads.clear();
  }

  listEntities(label: string, options: KfdbListEntitiesOptions = {}): Promise<KfdbListEntitiesResponse> {
    const resolved = { ...options, scope: options.scope ?? this.defaults.scope };
    return this.once(`list:${label}:${canonical(resolved)}`, () => this.client.listEntities(label, resolved));
  }

  getEntity(label: string, id: string, options: KfdbGetEntityOptions = {}): Promise<KfdbEntityResponse> {
    const resolved = { ...options, scope: options.scope ?? this.defaults.scope };
    return this.once(`get:${label}:${id}:${canonical(resolved)}`, () => this.client.getEntity(label, id, resolved));
  }

  batchGetEntities(request: KfdbBatchGetEntitiesRequest): Promise<KfdbBatchGetEntitiesResponse> {
    const resolved = { ...request, scope: request.scope ?? this.defaults.scope };
    return this.once(`batch:${canonical(resolved)}`, async () => {
      if (resolved.entities.length === 0) {
        return { entities: {}, missing: [], resolved: 0, requested: 0 };
      }
      const pages: KfdbBatchGetEntitiesResponse[] = [];
      for (let offset = 0; offset < resolved.entities.length; offset += BATCH_LIMIT) {
        pages.push(await this.client.batchGetEntities({
          ...resolved,
          entities: resolved.entities.slice(offset, offset + BATCH_LIMIT),
        }));
      }
      return {
        entities: Object.assign({}, ...pages.map((page) => page.entities)),
        missing: pages.flatMap((page) => page.missing),
        resolved: pages.reduce((sum, page) => sum + page.resolved, 0),
        requested: pages.reduce((sum, page) => sum + page.requested, 0),
      };
    });
  }

  private once<T>(key: string, read: () => Promise<T>): Promise<T> {
    const existing = this.reads.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = read().catch((error) => {
      if (this.reads.get(key) === promise) this.reads.delete(key);
      throw error;
    });
    this.reads.set(key, promise);
    return promise;
  }
}
