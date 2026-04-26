export { KFDBClient } from './client.js';
export { MemoryDeriveSessionStore, FileDeriveSessionStore } from './derive-session-store.js';
export { buildAgentChatTraceOperations, createAgentChatTraceFixture } from './agent-chat-trace.js';
export type { AgentChatTraceEvent, AgentChatTurnTrace } from './agent-chat-trace.js';

export type {
  AutoDeriveOptions,
  DeriveChallenge,
  DeriveKeyResult,
  DeriveSession,
  DeriveSessionStore,
  KfdbBatchGetEntitiesRequest,
  KfdbBatchGetEntitiesResponse,
  KfdbClientConfig,
  KfdbEntityRef,
  KfdbEntityResponse,
  KfdbFilterEntitiesRequest,
  KfdbGetEntityOptions,
  KfdbLabelInfo,
  KfdbListEntitiesOptions,
  KfdbListEntitiesResponse,
  KfdbListLabelsResponse,
  KfdbQueryScope,
  KfdbWriteRequest,
  KfdbWriteResponse,
} from './types.js';
