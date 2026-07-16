import { createKnowledgeWorkPipeline } from './pipeline.js';
import type {
  KnowledgeContextPack,
  KnowledgeContextPackOptions,
  KnowledgeWorkAnchor,
  KnowledgeWorkClientConfig,
  KnowledgeWorkPipelineModel,
} from './types.js';
import { MemoryKnowledgeWorkCacheStore } from './cache.js';

const QUERY_KEY: Record<KnowledgeWorkAnchor['kind'], string> = {
  surface: 'surface', task: 'task', repo: 'repo', lesson: 'lesson',
};

export class KnowledgeWorkHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'KnowledgeWorkHttpError';
    this.status = status;
  }
}

function signalWithTimeout(user: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(user?.reason);
  if (user?.aborted) onAbort();
  else user?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error(`Knowledge work request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      user?.removeEventListener('abort', onAbort);
    },
  };
}

export class KnowledgeWorkClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly headers?: KnowledgeWorkClientConfig['headers'];
  private readonly timeoutMs: number;
  private readonly consumer: string;
  private readonly cache: NonNullable<KnowledgeWorkClientConfig['cache']> | null;
  private readonly cacheScope: NonNullable<KnowledgeWorkClientConfig['cacheScope']>;
  private readonly cacheTtlMs: number;
  private readonly staleWhileRevalidateMs: number;
  private readonly clearCacheOnScopeChange: boolean;
  private readonly onCacheEvent?: KnowledgeWorkClientConfig['onCacheEvent'];
  private readonly now: () => number;
  private lastScope: string | null = null;
  private readonly packInFlight = new Map<string, Promise<KnowledgeContextPack>>();
  private readonly pipelineInFlight = new Map<string, Promise<KnowledgeWorkPipelineModel>>();

  constructor(config: KnowledgeWorkClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? '').replace(/\/$/, '');
    this.fetcher = config.fetch ?? globalThis.fetch;
    this.headers = config.headers;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.consumer = config.consumer?.trim() || 'sdk';
    this.cache = config.cache === undefined ? new MemoryKnowledgeWorkCacheStore() : config.cache;
    this.cacheScope = config.cacheScope ?? (() => 'default');
    this.cacheTtlMs = Math.max(0, config.cacheTtlMs ?? 60_000);
    this.staleWhileRevalidateMs = Math.max(this.cacheTtlMs, config.staleWhileRevalidateMs ?? 600_000);
    this.clearCacheOnScopeChange = config.clearCacheOnScopeChange ?? true;
    this.onCacheEvent = config.onCacheEvent;
    this.now = config.now ?? Date.now;
  }

  async getContextPack(anchor: KnowledgeWorkAnchor, options: KnowledgeContextPackOptions = {}): Promise<KnowledgeContextPack> {
    if (!anchor.key.trim()) throw new Error('Knowledge work anchor key is required');
    const scope = (await this.cacheScope()).trim() || 'default';
    await this.handleScopeChange(scope);
    const selector = JSON.stringify([anchor, { budget: options.budget, consumer: options.consumer ?? this.consumer, asOf: options.asOf }]);
    const requestKey = `knowledge-work:${encodeURIComponent(scope)}:${selector}`;
    const alias = this.cache ? await this.readCache(requestKey, scope) : null;
    if (alias) {
      const ageMs = Math.max(0, this.now() - alias.storedAt);
      if (ageMs <= this.cacheTtlMs) {
        this.emit({ type: 'hit', scope, key: requestKey, ageMs });
        return alias.pack;
      }
      if (ageMs <= this.staleWhileRevalidateMs) {
        this.emit({ type: 'stale', scope, key: requestKey, ageMs });
        void this.fetchAndCache(requestKey, scope, anchor, options, true).catch(() => {});
        return alias.pack;
      }
      await this.cache?.delete(requestKey).catch(() => this.emit({ type: 'cache_error', scope, key: requestKey }));
    }
    this.emit({ type: 'miss', scope, key: requestKey });
    return this.fetchAndCache(requestKey, scope, anchor, options, false);
  }

  private async fetchContextPack(anchor: KnowledgeWorkAnchor, options: KnowledgeContextPackOptions): Promise<{ pack: KnowledgeContextPack; snapshotHash?: string }> {
    const params = new URLSearchParams({ [QUERY_KEY[anchor.kind]]: anchor.key, consumer: options.consumer ?? this.consumer });
    if (options.budget != null) params.set('budget', String(options.budget));
    if (options.asOf) params.set('as_of', options.asOf);
    const path = `/api/context-pack?${params.toString()}`;
    const timed = signalWithTimeout(options.signal, this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        headers: this.headers ? await this.headers() : undefined,
        signal: timed.signal,
      });
      const body = await response.json().catch(() => null) as (KnowledgeContextPack & { error?: string }) | null;
      if (!response.ok) throw new KnowledgeWorkHttpError(response.status, body?.error || `Knowledge work request failed (${response.status})`);
      if (!body || body.version !== 'context-pack/v1') throw new KnowledgeWorkHttpError(502, 'Host returned an invalid context pack');
      return {
        pack: body,
        snapshotHash: response.headers.get('x-rickydata-context-snapshot-hash') ?? undefined,
      };
    } finally {
      timed.cleanup();
    }
  }

  getPipeline(anchor: KnowledgeWorkAnchor, options: KnowledgeContextPackOptions = {}): Promise<KnowledgeWorkPipelineModel> {
    const key = JSON.stringify([anchor, { budget: options.budget, consumer: options.consumer, asOf: options.asOf }]);
    const existing = this.pipelineInFlight.get(key);
    if (existing) return existing;
    const promise = this.getContextPack(anchor, options)
      .then(createKnowledgeWorkPipeline)
      .finally(() => this.pipelineInFlight.delete(key));
    this.pipelineInFlight.set(key, promise);
    return promise;
  }

  private async readCache(key: string, scope: string): Promise<import('./types.js').KnowledgeWorkCacheEntry | null> {
    if (!this.cache) return null;
    try {
      const alias = await this.cache.get(key);
      if (!alias?.snapshotHash) return alias;
      return await this.cache.get(`knowledge-snapshot:${encodeURIComponent(scope)}:${alias.snapshotHash}`) ?? alias;
    } catch {
      this.emit({ type: 'cache_error', scope, key });
      return null;
    }
  }

  private fetchAndCache(
    key: string,
    scope: string,
    anchor: KnowledgeWorkAnchor,
    options: KnowledgeContextPackOptions,
    refresh: boolean,
  ): Promise<KnowledgeContextPack> {
    const existing = this.packInFlight.get(key);
    if (existing) return existing;
    const started = this.now();
    if (refresh) this.emit({ type: 'refresh', scope, key });
    const promise = this.fetchContextPack(anchor, options)
      .then(async ({ pack, snapshotHash }) => {
        if (this.cache) {
          const entry = { pack, snapshotHash, scope, storedAt: this.now() };
          try {
            if (snapshotHash) await this.cache.set(`knowledge-snapshot:${encodeURIComponent(scope)}:${snapshotHash}`, entry);
            await this.cache.set(key, entry);
            this.emit({ type: 'write', scope, key, durationMs: this.now() - started });
          } catch {
            this.emit({ type: 'cache_error', scope, key });
          }
        }
        return pack;
      })
      .catch((error) => {
        if (refresh) this.emit({ type: 'refresh_error', scope, key, durationMs: this.now() - started });
        throw error;
      })
      .finally(() => this.packInFlight.delete(key));
    this.packInFlight.set(key, promise);
    return promise;
  }

  private async handleScopeChange(scope: string): Promise<void> {
    const previous = this.lastScope;
    this.lastScope = scope;
    if (previous && previous !== scope && this.clearCacheOnScopeChange && this.cache?.clearScope) {
      try {
        await this.cache.clearScope(previous);
      } catch {
        this.emit({ type: 'cache_error', scope: previous, key: 'scope' });
      }
    }
  }

  private emit(event: import('./types.js').KnowledgeWorkCacheEvent): void {
    try { this.onCacheEvent?.(event); } catch { /* metrics must not break retrieval */ }
  }
}
