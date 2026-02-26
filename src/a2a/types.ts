/**
 * A2A Protocol Type Definitions for SDK Client
 *
 * Types matching the Agent Gateway's A2A v0.3 implementation.
 * Reference: https://a2a-protocol.org/latest/specification/
 */

// ─── Agent Card ──────────────────────────────────────────────

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentProvider {
  organization: string;
  url: string;
}

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

export interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  description?: string;
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  provider: AgentProvider;
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  securitySchemes: Record<string, SecurityScheme>;
  security: Record<string, string[]>[];
}

export interface ExtendedAgentCard extends AgentCard {
  user?: {
    walletAddress: string;
    availableBalance?: string;
    model?: string;
  };
}

// ─── Message Parts ───────────────────────────────────────────

export interface TextPart {
  type: 'text';
  text: string;
}

export interface FilePart {
  type: 'file';
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;
    uri?: string;
  };
}

export interface DataPart {
  type: 'data';
  data: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

// ─── Messages ────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'agent';
  parts: Part[];
  metadata?: Record<string, unknown>;
}

// ─── Task ────────────────────────────────────────────────────

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'unknown';

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp: string;
}

export interface Artifact {
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
  index: number;
  append?: boolean;
  lastChunk?: boolean;
}

export interface TaskCost {
  total: string;
  llm: string;
  tools: string;
  model: string;
  byok?: boolean;
}

export interface Task {
  id: string;
  contextId?: string;
  sessionId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

// ─── Requests ────────────────────────────────────────────────

export interface SendMessageConfiguration {
  acceptedOutputModes?: string[];
  historyLength?: number;
  blocking?: boolean;
}

export interface SendMessageRequest {
  message: Message;
  configuration?: SendMessageConfiguration;
  metadata?: Record<string, unknown>;
}

// ─── Streaming Events ────────────────────────────────────────

export interface TaskStatusUpdateEvent {
  id: string;
  status: TaskStatus;
  final: boolean;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  id: string;
  artifact: Artifact;
  metadata?: Record<string, unknown>;
}

export type StreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ─── List Response ───────────────────────────────────────────

export interface TaskListResponse {
  tasks: Task[];
  nextPageToken?: string;
}

export interface ListTasksOptions {
  limit?: number;
  pageToken?: string;
  contextId?: string;
  status?: string;
}

// ─── JSON-RPC ────────────────────────────────────────────────

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── Client Config ───────────────────────────────────────────

export interface A2AClientConfig {
  baseUrl: string;
  token?: string;
}
