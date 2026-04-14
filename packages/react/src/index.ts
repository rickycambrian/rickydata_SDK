// Provider
export { RickyDataProvider, useRickyData, useRickyDataWalletTransport } from './providers/RickyDataProvider.js';
export type { RickyDataProviderProps, RickyDataWalletTransport } from './providers/RickyDataProvider.js';

// Hooks — Agents
export { useAgents, useAgent, agentKeys } from './hooks/agents.js';

// Hooks — API Key
export {
  useApiKeyStatus, useSetApiKey, useDeleteApiKey,
  apiKeyKeys,
} from './hooks/apikey.js';

// Hooks — Balance
export { useWalletBalance, useWalletTransactions, balanceKeys } from './hooks/balance.js';

// Hooks — Sessions
export { useSessions, useSession, useDeleteSession, sessionKeys } from './hooks/sessions.js';

// Hooks — Wallet Settings
export { useWalletSettings, walletSettingsKeys } from './hooks/wallet-settings.js';

// Hooks — Free Tier
export { useFreeTierStatus, freeTierKeys } from './hooks/free-tier.js';
export type { UseFreeTierStatusOptions } from './hooks/free-tier.js';

// Hooks — Wallet Plan
export { useWalletPlan } from './hooks/wallet-plan.js';

// Hooks — Secrets
export { useSecrets } from './hooks/secrets.js';

// Hooks — Chat (SSE streaming)
export { useAgentChat } from './hooks/chat.js';
export type {
  UseAgentChatOptions, UseAgentChatResult,
  ChatSidebarState, ToolApprovalData, TransactionSigningData,
} from './hooks/chat.js';

// Hooks — Voice (LiveKit)
export {
  useAgentVoiceChat,
  speakNarration,
  humanizeToolName,
  createNarration,
  computeVoicePhase,
  NARRATION_VOICE_RATE,
  NARRATION_VOICE_VOLUME,
} from './hooks/voice.js';
export type { UseAgentVoiceChatOptions, UseAgentVoiceChatResult, NarrationEvent } from './hooks/voice.js';

// Components
export { SecretForm } from './components/SecretForm.js';
export type { SecretFormProps } from './components/SecretForm.js';

export { SecretOrchestrator } from './components/SecretOrchestrator.js';
export type { SecretOrchestratorProps } from './components/SecretOrchestrator.js';

export { WalletChip } from './components/WalletChip.js';
export type { WalletChipProps } from './components/WalletChip.js';

export { DepositPanel } from './components/DepositPanel.js';
export type { DepositPanelProps, DepositStatus } from './components/DepositPanel.js';

export { FreeTierBar } from './components/FreeTierBar.js';
export type { FreeTierBarProps } from './components/FreeTierBar.js';

export { ProviderSettingsCard } from './components/ProviderSettingsCard.js';
export type { ProviderSettingsCardProps } from './components/ProviderSettingsCard.js';

export { WalletStatusBadge } from './components/WalletStatusBadge.js';
export type { WalletStatusBadgeProps } from './components/WalletStatusBadge.js';

export { UsageDashboard } from './components/UsageDashboard.js';
export type { UsageDashboardProps } from './components/UsageDashboard.js';

// Types
export type {
  ChatMessage, ChatImage, ToolExecution, SecretSection,
  VoiceConnectionState, VoicePhase, VoiceTranscript, VoiceToolCallInfo,
} from './types.js';

// Re-export key types from core for convenience
export type {
  AgentInfo,
  AgentDetailResponse,
  AgentClientConfig,
  SessionListEntry,
  SessionDetail,
  WalletSettings,
  WalletPlan,
  FreeTierStatus,
  WalletBalanceResponse,
  SSEEvent,
} from 'rickydata/agent';
