import type { WrappedGroupKey } from '../encryption.js';

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

export interface KfdbQueryOptions {
  scope?: KfdbQueryScope;
  signal?: AbortSignal;
}

export interface KfdbQueryResponse {
  rows?: Record<string, unknown>[];
  columns?: string[];
  execution_time_ms?: number;
  [key: string]: unknown;
}

export interface KfdbExplainResponse {
  plan?: unknown;
  query?: string;
  [key: string]: unknown;
}

export type KfdbPropertyValue =
  | { String: string }
  | { Integer: number }
  | { Float: number }
  | { Boolean: boolean }
  | { Vector: number[] };

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

// ── Shared Notebook Key Types ───────────────────────────────────────

export type KfdbSharedNotebookRole = 'owner' | 'editor' | 'viewer';
export type KfdbSharedNotebookKeyAlgorithm = 'X25519';

export interface KfdbEnrollSharingKeyRequest {
  /** Base64-encoded 32-byte X25519 public key from generateSharingKeyPair(). */
  public_key: string;
  algorithm?: KfdbSharedNotebookKeyAlgorithm;
  label?: string;
  device_id?: string;
}

export interface KfdbSharingKey {
  key_id: string;
  public_key: string;
  algorithm: KfdbSharedNotebookKeyAlgorithm;
  label?: string;
  device_id?: string;
  wallet_address?: string;
  created_at?: string;
  revoked_at?: string | null;
}

export interface KfdbListSharingKeysResponse {
  keys: KfdbSharingKey[];
}

export interface KfdbCreateSharedNotebookRequest {
  workspace_id: string;
  title_ciphertext: string;
  content_ciphertext: string;
  metadata_ciphertext?: string;
  content_hash: string;
  encryption_algo?: string;
  key_version?: string;
  client_metadata?: string;
  dek_envelopes: KfdbSharedNotebookDekEnvelope[];
}

export interface KfdbUpdateSharedNotebookRequest {
  base_version: number;
  base_hash: string;
  title_ciphertext: string;
  content_ciphertext: string;
  metadata_ciphertext?: string;
  content_hash: string;
  encryption_algo?: string;
  key_version?: string;
  client_metadata?: string;
  change_summary?: string;
  dek_envelopes?: KfdbSharedNotebookDekEnvelope[];
}

export interface KfdbSharedNotebookDekEnvelope {
  wallet_address: string;
  wrapped_dek: string;
  algo?: string;
  key_version?: string;
  public_key_hash?: string;
}

export interface KfdbSharedNotebook {
  notebook_id: string;
  workspace_id: string;
  title_ciphertext: string;
  content_ciphertext: string;
  metadata_ciphertext?: string | null;
  content_hash: string;
  current_version: number;
  encryption_algo: string;
  key_version: string;
  client_metadata?: string | null;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  dek_envelopes?: KfdbSharedNotebookDekEnvelope[];
}

export interface KfdbSharedNotebookWriteResponse {
  notebook_id: string;
  workspace_id: string;
  current_version: number;
  content_hash: string;
}

export interface KfdbSharedNotebookVersion {
  notebook_id: string;
  version_number: number;
  content_hash: string;
  title_ciphertext: string;
  content_ciphertext: string;
  metadata_ciphertext?: string | null;
  actor_wallet: string;
  actor_user_id: string;
  actor_tenant_id: string;
  actor_action: string;
  change_summary?: string | null;
  created_at: number;
  base_version?: number | null;
  base_hash?: string | null;
}

export interface KfdbListSharedNotebooksResponse {
  notebooks: KfdbSharedNotebook[];
}

export interface KfdbShareNotebookRequest {
  recipient_wallet_address: string;
  recipient_sharing_key_id: string;
  role: KfdbSharedNotebookRole;
  key_id: string;
  wrapped_group_key: WrappedGroupKey;
}

export interface KfdbSharedNotebookMember {
  wallet_address: string;
  role: KfdbSharedNotebookRole;
  sharing_key_id?: string;
  key_id?: string;
  joined_at?: string;
}

export interface KfdbShareNotebookResponse {
  notebook_id: string;
  member: KfdbSharedNotebookMember;
}

export interface KfdbListSharedNotebookMembersResponse {
  members: KfdbSharedNotebookMember[];
}

export interface KfdbUpsertSharedNotebookGroupKeyRequest {
  notebook_id: string;
  recipient_wallet_address: string;
  recipient_sharing_key_id: string;
  key_id: string;
  wrapped_group_key: WrappedGroupKey;
}

export interface KfdbSharedNotebookGroupKey {
  notebook_id: string;
  recipient_wallet_address: string;
  recipient_sharing_key_id?: string;
  key_id: string;
  wrapped_group_key: WrappedGroupKey;
  created_at?: string;
  updated_at?: string;
}

export interface KfdbListSharedNotebookGroupKeysResponse {
  keys: KfdbSharedNotebookGroupKey[];
}
