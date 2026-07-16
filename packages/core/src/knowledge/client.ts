import { createKnowledgeWorkPipeline } from './pipeline.js';
import type {
  KnowledgeContextPack,
  KnowledgeContextPackOptions,
  KnowledgeWorkAnchor,
  KnowledgeWorkClientConfig,
  KnowledgeWorkPipelineModel,
} from './types.js';

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
  private readonly inFlight = new Map<string, Promise<KnowledgeWorkPipelineModel>>();

  constructor(config: KnowledgeWorkClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? '').replace(/\/$/, '');
    this.fetcher = config.fetch ?? globalThis.fetch;
    this.headers = config.headers;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.consumer = config.consumer?.trim() || 'sdk';
  }

  async getContextPack(anchor: KnowledgeWorkAnchor, options: KnowledgeContextPackOptions = {}): Promise<KnowledgeContextPack> {
    if (!anchor.key.trim()) throw new Error('Knowledge work anchor key is required');
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
      return body;
    } finally {
      timed.cleanup();
    }
  }

  getPipeline(anchor: KnowledgeWorkAnchor, options: KnowledgeContextPackOptions = {}): Promise<KnowledgeWorkPipelineModel> {
    const key = JSON.stringify([anchor, { budget: options.budget, consumer: options.consumer, asOf: options.asOf }]);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const promise = this.getContextPack(anchor, options)
      .then(createKnowledgeWorkPipeline)
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}
