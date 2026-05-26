export { KFDBClient } from './client.js';
export { MemoryDeriveSessionStore, FileDeriveSessionStore } from './derive-session-store.js';
export { buildAgentChatTraceOperations, createAgentChatTraceFixture } from './agent-chat-trace.js';
export { buildClaudeCodeHookTraceOperations, createClaudeCodeHookTraceFixture } from './claude-code-hook-trace.js';
export { buildCodexHookTraceOperations, createCodexHookTraceFixture } from './codex-hook-trace.js';
export { buildHermesHookTraceOperations, createHermesHookTraceFixture } from './hermes-hook-trace.js';
export {
  GraphEdgeType,
  GraphEntityKind,
  RICKYDATA_GRAPH_NAMESPACE,
  RICKYDATA_GRAPH_SCHEMA_VERSION,
  buildRickydataGraphWriteRequest,
  canonicalizeRickydataRepoRef,
  deriveRickydataGraphEdgeId,
  deriveRickydataGraphId,
  rickydataGraphContract,
  rickydataGraphValue,
} from './rickydata-graph.js';
export { kfdbValue } from './values.js';
export {
  generateSharingKeyPair,
  generateSharedNotebookGroupKey,
  importSharedNotebookGroupKey,
  wrapSharedNotebookGroupKey,
  unwrapSharedNotebookGroupKey,
  encryptSharedNotebookField,
  decryptSharedNotebookField,
  encryptSharedNotebookFields,
  decryptSharedNotebookRows,
} from '../encryption.js';
export type { SharingKeyPair, WrappedGroupKey } from '../encryption.js';
export type { AgentChatTraceEvent, AgentChatTurnTrace } from './agent-chat-trace.js';
export type { ClaudeCodeHookEventRecord, ClaudeCodeHookTrace } from './claude-code-hook-trace.js';
export type { CodexHookEventRecord, CodexHookTrace } from './codex-hook-trace.js';
export type { HermesHookEventRecord, HermesHookTrace } from './hermes-hook-trace.js';
export type {
  RickydataGraphContract,
  RickydataGraphEdge,
  RickydataGraphNode,
  RickydataGraphPrimitiveValue,
  RickydataGraphWriteInput,
  RickydataGraphWriteOperation,
  RickydataGraphWriteRequest,
} from './rickydata-graph.js';

export type {
  AutoDeriveOptions,
  DeriveChallenge,
  DeriveKeyResult,
  DeriveSession,
  DeriveSessionStore,
  KfdbBatchGetEntitiesRequest,
  KfdbBatchGetEntitiesResponse,
  KfdbClientConfig,
  KfdbCreateSharedNotebookRequest,
  KfdbEnrollSharingKeyRequest,
  KfdbEntityRef,
  KfdbEntityResponse,
  KfdbFilterEntitiesRequest,
  KfdbGetEntityOptions,
  KfdbLabelInfo,
  KfdbListEntitiesOptions,
  KfdbListEntitiesResponse,
  KfdbListLabelsResponse,
  KfdbListSharedNotebookGroupKeysResponse,
  KfdbListSharedNotebookMembersResponse,
  KfdbListSharedNotebooksResponse,
  KfdbListSharingKeysResponse,
  KfdbExplainResponse,
  KfdbPropertyValue,
  KfdbQueryOptions,
  KfdbQueryResponse,
  KfdbQueryScope,
  KfdbShareNotebookRequest,
  KfdbShareNotebookResponse,
  KfdbSharedNotebook,
  KfdbSharedNotebookGroupKey,
  KfdbSharedNotebookKeyAlgorithm,
  KfdbSharedNotebookMember,
  KfdbSharedNotebookRole,
  KfdbSharingKey,
  KfdbUpsertSharedNotebookGroupKeyRequest,
  KfdbWriteRequest,
  KfdbWriteResponse,
} from './types.js';
