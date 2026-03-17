export { AutomationClient } from './automation-client.js';

export type {
  // Enums
  TriggerType,
  OperationType,
  LlmProvider,
  OutputStrategy,
  ExecutionStatus,

  // Core entities
  TriggerFilters,
  AutomationRule,
  ExecutionLog,

  // Create / Update
  CreateRuleRequest,
  UpdateRuleRequest,

  // Responses
  RuleResponse,
  ListRulesResponse,
  RuleOperationResponse,
  ExecutionResponse,
  ExecutionLogsResponse,

  // Config
  AutomationClientConfig,
} from './types.js';
