export type KfdbQueryScope = 'global' | 'private';

export interface KfdbClientConfig {
  baseUrl: string;
  token?: string;
  apiKey?: string;
  defaultReadScope?: KfdbQueryScope;
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
