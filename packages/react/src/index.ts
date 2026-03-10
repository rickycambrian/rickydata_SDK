// Provider
export { RickyDataProvider, useRickyData } from './providers/RickyDataProvider.js';
export type { RickyDataProviderProps } from './providers/RickyDataProvider.js';

// Hooks — Agents
export { useAgents, useAgent, agentKeys } from './hooks/agents.js';

// Hooks — API Key
export {
  useApiKeyStatus, useSetApiKey, useDeleteApiKey,
  useOpenAIApiKeyStatus, useSetOpenAIApiKey,
  apiKeyKeys,
} from './hooks/apikey.js';

// Hooks — Balance
export { useWalletBalance, useWalletTransactions, balanceKeys } from './hooks/balance.js';

// Hooks — Sessions
export { useSessions, useSession, useDeleteSession, sessionKeys } from './hooks/sessions.js';

// Hooks — Wallet Settings
export { useWalletSettings, walletSettingsKeys } from './hooks/wallet-settings.js';

// Hooks — Secrets
export { useSecrets } from './hooks/secrets.js';

// Hooks — Chat (SSE streaming)
export { useAgentChat } from './hooks/chat.js';
export type { UseAgentChatOptions, UseAgentChatResult } from './hooks/chat.js';

// Components
export { SecretForm } from './components/SecretForm.js';
export type { SecretFormProps } from './components/SecretForm.js';

export { SecretOrchestrator } from './components/SecretOrchestrator.js';
export type { SecretOrchestratorProps } from './components/SecretOrchestrator.js';

export { WalletChip } from './components/WalletChip.js';
export type { WalletChipProps } from './components/WalletChip.js';

// Types
export type { ChatMessage, ToolExecution, SecretSection } from './types.js';

// Re-export key types from core for convenience
export type {
  AgentInfo,
  AgentDetailResponse,
  AgentClientConfig,
  SessionListEntry,
  SessionDetail,
  WalletSettings,
  WalletBalanceResponse,
  SSEEvent,
} from 'rickydata/agent';
