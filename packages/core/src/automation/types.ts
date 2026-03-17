/**
 * Automation Rule Type Definitions
 *
 * Types for the event-driven automation system -- rules that trigger
 * LLM operations (summarize, embed, classify, extract) when graph
 * events occur (node/edge created, updated, deleted).
 *
 * These types mirror the Rust backend in knowledgeflow_db
 * (crates/kfdb-automation/src/types.rs and crates/kfdb-api/src/automation/types.rs).
 */

// ── Enums ─────────────────────────────────────────────────────────────────

/** Graph event that triggers the automation rule */
export type TriggerType =
  | 'node_created'
  | 'node_updated'
  | 'node_deleted'
  | 'edge_created'
  | 'edge_deleted'
  | 'property_added'
  | 'property_updated';

/** LLM operation to perform when the rule fires */
export type OperationType =
  | 'generate_embedding'
  | 'summarize'
  | 'extract_entities'
  | 'classify';

/** LLM provider for the operation */
export type LlmProvider = 'google' | 'openai' | 'anthropic';

/** How to store the LLM output */
export type OutputStrategy = 'update_property' | 'create_node' | 'create_edge';

/** Status of a rule execution */
export type ExecutionStatus = 'pending' | 'success' | 'failed';

// ── Core Entities ─────────────────────────────────────────────────────────

/** Filters that narrow which graph events trigger a rule */
export interface TriggerFilters {
  /** Only trigger for nodes/edges with this label */
  label_filter?: string;
  /** Only trigger for nodes/edges with these properties */
  property_filters?: Record<string, string>;
}

/** An automation rule definition */
export interface AutomationRule {
  rule_id: string;
  tenant_id: string;
  name: string;
  description?: string;

  // Trigger configuration
  trigger_type: TriggerType;
  trigger_filters: TriggerFilters;

  // LLM operation
  operation_type: OperationType;
  llm_provider: LlmProvider;
  llm_model: string;
  prompt_template?: string;
  input_property: string;

  // Output configuration
  output_strategy: OutputStrategy;
  output_property?: string;
  output_node_label?: string;

  // Control
  is_active: boolean;
  max_tokens?: number;
  temperature?: number;

  // Metadata
  created_at: string;
  updated_at: string;
  created_by?: string;
}

/** Log of a single rule execution */
export interface ExecutionLog {
  execution_id: string;
  tenant_id: string;
  rule_id: string;

  // Event context
  event_type: TriggerType;
  node_id?: string;
  edge_id?: string;

  // Execution details
  status: ExecutionStatus;
  input_text?: string;
  output_value?: string;
  error_message?: string;

  // Metrics
  execution_time_ms: number;
  tokens_used?: number;
  cost_usd?: number;

  // Timestamp
  timestamp: string;
}

// ── Create ────────────────────────────────────────────────────────────────

export interface CreateRuleRequest {
  name: string;
  description?: string;
  trigger_type: TriggerType;
  trigger_filters?: TriggerFilters;
  operation_type: OperationType;
  llm_provider: LlmProvider;
  llm_model: string;
  prompt_template?: string;
  input_property: string;
  output_strategy: OutputStrategy;
  output_property?: string;
  output_node_label?: string;
  is_active: boolean;
  max_tokens?: number;
  temperature?: number;
}

// ── Update ────────────────────────────────────────────────────────────────

export interface UpdateRuleRequest {
  name?: string;
  description?: string;
  trigger_filters?: TriggerFilters;
  operation_type?: OperationType;
  llm_model?: string;
  prompt_template?: string;
  input_property?: string;
  output_strategy?: OutputStrategy;
  output_property?: string;
  output_node_label?: string;
  is_active?: boolean;
  max_tokens?: number;
  temperature?: number;
}

// ── Responses ─────────────────────────────────────────────────────────────

export interface RuleResponse {
  rule: AutomationRule;
}

export interface ListRulesResponse {
  rules: AutomationRule[];
  total: number;
}

export interface RuleOperationResponse {
  rule_id: string;
  message: string;
}

export interface ExecutionResponse {
  execution_id: string;
  log?: ExecutionLog;
}

export interface ExecutionLogsResponse {
  logs: ExecutionLog[];
  total: number;
}

// ── Client Config ─────────────────────────────────────────────────────────

export interface AutomationClientConfig {
  /** KFDB API base URL */
  baseUrl: string;
  /** API key for authentication (X-KF-API-Key header) */
  apiKey: string;
}
