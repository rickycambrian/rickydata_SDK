// Provider
export { ChatBubbleProvider, useChatBubbleConfig } from './providers/ChatBubbleProvider.js';
export type { ChatBubbleProviderProps, ChatBubbleConfig, ChatBubbleCallbacks } from './providers/ChatBubbleProvider.js';

// Components
export { AgentChatEmbed } from './components/AgentChatEmbed.js';
export type { AgentChatEmbedProps } from './components/AgentChatEmbed.js';
export { ChatBubble } from './components/ChatBubble.js';
export { ChatBubbleButton } from './components/ChatBubbleButton.js';
export { ChatBubbleWindow } from './components/ChatBubbleWindow.js';
export { ChatWindowHeader } from './components/ChatWindowHeader.js';
export { ChatInputBar } from './components/ChatInputBar.js';
export type { ChatInputBarProps } from './components/ChatInputBar.js';
export { ChatMessageList } from './components/ChatMessageList.js';
export type { ChatMessageListProps } from './components/ChatMessageList.js';
export { ActionConfirmationCard } from './components/ActionConfirmationCard.js';
export type { ActionConfirmationCardProps } from './components/ActionConfirmationCard.js';
export { ThreadDrawer } from './components/ThreadDrawer.js';
export type { ThreadDrawerProps } from './components/ThreadDrawer.js';
export { HighlightOverlay } from './components/HighlightOverlay.js';

// Full-page chat components (Tailwind-styled, marketplace-style)
export { ChatPage } from './components/ChatPage.js';
export type { ChatPageProps, ChatPageAgentInfo, ChatPageModelOption } from './components/ChatPage.js';
export { ChatMessageTimeline } from './components/ChatMessageTimeline.js';
export type { ChatMessageTimelineProps } from './components/ChatMessageTimeline.js';
export { ChatInputTimeline } from './components/ChatInputTimeline.js';
export type { ChatInputTimelineProps } from './components/ChatInputTimeline.js';
export { ToolCallInline } from './components/ToolCallInline.js';
export type { ToolCallInlineProps } from './components/ToolCallInline.js';
export { getToolCategory, TOOL_BORDER_COLORS } from './components/ToolCallInline.js';
export { ThinkingBlock } from './components/ThinkingBlock.js';
export type { ThinkingBlockProps } from './components/ThinkingBlock.js';
export { ChatInput } from './components/ChatInput.js';
export type { ChatInputProps } from './components/ChatInput.js';

// Hooks
export { useChatBubbleEngine } from './hooks/useChatBubbleEngine.js';
export type { UseChatBubbleEngineOptions, UseChatBubbleEngineReturn } from './hooks/useChatBubbleEngine.js';
export { useHostCopilotEngine, createHostActionHandler } from './hooks/useHostCopilotEngine.js';
export type { UseHostCopilotEngineOptions, UseHostCopilotEngineReturn } from './hooks/useHostCopilotEngine.js';
export { useCompanionContext } from './hooks/useCompanionContext.js';
export type { UseCompanionContextOptions } from './hooks/useCompanionContext.js';
export { useWalletAuth } from './hooks/useWalletAuth.js';
export type { WalletAuthStatus } from './hooks/useWalletAuth.js';
export { useBubble } from './hooks/useBubble.js';

// Stores (for external access via .getState())
export { useChatBubble } from './stores/bubble.js';
export type { ChatBubbleMode } from './stores/bubble.js';
export { useAgentActions } from './stores/actions.js';

// Adapters
export { createCustomAdapter } from './adapters/custom.js';
export type { CustomAdapterOptions } from './adapters/custom.js';
export { createPrivyAdapter } from './adapters/privy.js';
export { createMetaMaskAdapter } from './adapters/window-ethereum.js';

// Theme
export { darkTokens, lightTokens } from './theme/tokens.js';
export { injectThemeTokens } from './theme/inject.js';

// Types
export type { WalletAdapter } from './types/wallet.js';
export type {
  ChatMessage,
  ToolExecution,
  ChatContext,
  ChatEngine,
  DocumentAnchor,
  DocumentAnchorKind,
  CompanionTarget,
  CompanionPointerState,
  CompanionReadinessState,
  CompanionContextSnapshot,
  CompanionCursorStatus,
  CompanionCursorShadow,
} from './types/chat.js';
export type { Thread, ThreadListItem } from './types/thread.js';
export type { ActionProposal, HighlightTarget } from './types/actions.js';
export type { ChatBubbleEvent } from './types/events.js';
export type { ThemeConfig, ThemeTokens } from './types/theme.js';
export type {
  AgentActionRequest,
  AgentActionResult,
  AgentHostAdapter,
  AgentHostContextSnapshot,
  AgentTargetDescriptor,
} from './types/host.js';
export { applyHostEvent } from './host/apply.js';
export type { ApplyHostEventOptions } from './host/apply.js';
export { buildHostContextMessage, extractHostDirectives } from './host/protocol.js';
