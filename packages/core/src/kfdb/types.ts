export type KfdbQueryScope = 'global' | 'private';

export interface KfdbClientConfig {
  baseUrl: string;
  token?: string;
  apiKey?: string;
  defaultReadScope?: KfdbQueryScope;
  encryptionKey?: CryptoKey;
  /** Ethereum wallet address (0x-prefixed). When set, write() enforces that sign-to-derive is active. */
  walletAddress?: string;
}

export interface KfdbLabelInfo {
  label: string;
  count?: number;
}

export interface KfdbListLabelsResponse {
  labels: KfdbLabelInfo[];
  count: number;
}

export interface KfdbListEntitiesOptions {
  scope?: KfdbQueryScope;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeEmbeddings?: boolean;
}

export interface KfdbListEntitiesResponse {
  label: string;
  items: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  source: string;
}

export interface KfdbGetEntityOptions {
  scope?: KfdbQueryScope;
  includeEmbeddings?: boolean;
}

export interface KfdbEntityResponse {
  label: string;
  id: string;
  properties: Record<string, unknown>;
}

export interface KfdbFilterEntitiesRequest {
  scope?: KfdbQueryScope;
  filters?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeEmbeddings?: boolean;
}

export interface KfdbEntityRef {
  label: string;
  id: string;
}

export interface KfdbBatchGetEntitiesRequest {
  scope?: KfdbQueryScope;
  entities: KfdbEntityRef[];
  includeEmbeddings?: boolean;
}

export interface KfdbBatchGetEntitiesResponse {
  entities: Record<string, Record<string, unknown>>;
  missing: string[];
  resolved: number;
  requested: number;
}

export interface KfdbWriteRequest {
  operations: Array<Record<string, unknown>>;
  skip_embedding?: boolean;
}

export interface KfdbWriteResponse {
  operations_executed: number;
  execution_time_ms: number;
  affected_ids: string[];
}

// ── Sign-to-Derive Types ────────────────────────────────────────────

/** Cached derive session credentials. */
export interface DeriveSession {
  sessionId: string;
  keyHex: string;
  expiresAt: number;
  address: string;
}

/** Pluggable session persistence for sign-to-derive. */
export interface DeriveSessionStore {
  get(walletAddress: string): Promise<DeriveSession | null>;
  set(walletAddress: string, session: DeriveSession): Promise<void>;
  clear(walletAddress: string): Promise<void>;
}

/** Options for KFDBClient.autoDerive(). */
export interface AutoDeriveOptions {
  /** Session cache — skips challenge/sign when a valid session exists. */
  sessionStore?: DeriveSessionStore;
  /** Safety margin in ms before session expiry to trigger re-derive. Default: 60_000 (60s). */
  refreshMarginMs?: number;
}

/** Server response from /api/v1/auth/derive-challenge. */
export interface DeriveChallenge {
  challenge_id: string;
  typed_data: Record<string, unknown>;
}

/** Server response from /api/v1/auth/derive-key. */
export interface DeriveKeyResult {
  session_id: string;
  /** KFDB may return Unix seconds or milliseconds; KFDBClient normalizes to milliseconds internally. */
  expires_at: number;
  key_hex?: string;
}
