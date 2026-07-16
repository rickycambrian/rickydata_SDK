export type KnowledgeWorkAnchorKind = 'surface' | 'task' | 'repo' | 'lesson';

export interface KnowledgeWorkAnchor {
  kind: KnowledgeWorkAnchorKind;
  key: string;
}

export interface KnowledgeContextPackSourceHealth {
  source: string;
  status: 'ok' | 'error' | 'not_configured' | 'not_applicable';
  count: number;
  required?: boolean;
  reason?: string;
}

export interface KnowledgeContextPack {
  version: 'context-pack/v1';
  context_pack_id?: string;
  selected_manifest_hash?: string;
  compiled_at: string;
  reproducibility_hash: string;
  token_estimate: number;
  policy_hash?: string;
  as_of?: string;
  anchor: {
    kind: KnowledgeWorkAnchorKind;
    surface?: string;
    taskSlug?: string;
    repoId?: string;
    lesson?: string;
  };
  brief: string;
  invariants: Array<{ text: string; source_ref: string }>;
  verification: Array<{ kind: string; status: string; evidence_ref?: string }>;
  work_in_progress: Array<Record<string, unknown>>;
  wiki: Array<{
    slug: string;
    title: string;
    summary: string;
    status: string;
    rank_reason: string;
    key_claims?: Array<{ text: string; source_ref: string; confidence_tier: string }>;
    excerpts?: string[];
  }>;
  lessons: Array<{ text: string; confidence: number; source_ref: string }>;
  decisions: Array<{ title: string; action: string; decided_at: string; source_ref_id: string }>;
  traps: Array<{ name: string; hook: string }>;
  open_questions: Array<{ question: string; id: string }>;
  allowed_tools?: string[];
  omitted: Array<{ section: string; count: number; reason: string }>;
  coverage?: {
    status: 'complete' | 'bounded' | 'incomplete';
    sources: KnowledgeContextPackSourceHealth[];
  };
  selected_items: Array<{
    section: string;
    id: string;
    content_hash: string;
    rank_reason?: string;
    token_estimate: number;
  }>;
  omitted_items: Array<{ section: string; id: string; reason: string }>;
}

export type KnowledgeWorkStepId =
  | 'orient'
  | 'constraints'
  | 'current-work'
  | 'evidence'
  | 'knowledge'
  | 'decisions'
  | 'questions';

export type KnowledgeWorkStepStatus = 'ready' | 'empty' | 'omitted' | 'incomplete';

export interface KnowledgeWorkStep {
  id: KnowledgeWorkStepId;
  label: string;
  description: string;
  status: KnowledgeWorkStepStatus;
  itemCount: number;
  omittedCount: number;
  sections: string[];
}

export interface KnowledgeWorkPipelineModel {
  version: 'knowledge-work/v1';
  anchor: KnowledgeWorkAnchor;
  brief: string;
  coverage: 'complete' | 'bounded' | 'incomplete';
  compiledAt: string;
  reproducibilityHash: string;
  tokenEstimate: number;
  steps: KnowledgeWorkStep[];
}

export interface KnowledgeWorkClientConfig {
  /** Home/host origin. Empty means same-origin in a browser. */
  baseUrl?: string;
  /** Host-owned wallet authentication. Privileged KFDB credentials stay server-side. */
  headers?: () => HeadersInit | Promise<HeadersInit>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  consumer?: string;
  /** Cache adapter. Omit for a bounded in-memory cache; pass null to disable. */
  cache?: KnowledgeWorkCacheStore | null;
  /** Stable tenant/wallet key. Required when one client can serve multiple users. */
  cacheScope?: () => string | Promise<string>;
  cacheTtlMs?: number;
  staleWhileRevalidateMs?: number;
  /** Clears the previous tenant's device entries when cacheScope changes. Default true. */
  clearCacheOnScopeChange?: boolean;
  onCacheEvent?: (event: KnowledgeWorkCacheEvent) => void;
  /** Deterministic clock seam for tests. */
  now?: () => number;
}

export interface KnowledgeContextPackOptions {
  budget?: number;
  consumer?: string;
  asOf?: string;
  signal?: AbortSignal;
}

export interface KnowledgeWorkCacheEntry {
  storedAt: number;
  scope?: string;
  snapshotHash?: string;
  pack: KnowledgeContextPack;
}

export interface KnowledgeWorkCacheStore {
  get(key: string): Promise<KnowledgeWorkCacheEntry | null>;
  set(key: string, entry: KnowledgeWorkCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clearScope?(scope: string): Promise<void>;
}

export type KnowledgeWorkCacheEventType =
  | 'hit' | 'miss' | 'stale' | 'refresh' | 'refresh_error' | 'write' | 'cache_error';

export interface KnowledgeWorkCacheEvent {
  type: KnowledgeWorkCacheEventType;
  scope: string;
  key: string;
  ageMs?: number;
  durationMs?: number;
}
