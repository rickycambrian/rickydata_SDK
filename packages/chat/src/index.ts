// Provider
export { ChatBubbleProvider, useChatBubbleConfig } from './providers/ChatBubbleProvider.js';
export type { ChatBubbleProviderProps, ChatBubbleConfig, ChatBubbleCallbacks } from './providers/ChatBubbleProvider.js';

// Components
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

// Hooks
export { useChatBubbleEngine } from './hooks/useChatBubbleEngine.js';
export type { UseChatBubbleEngineOptions, UseChatBubbleEngineReturn } from './hooks/useChatBubbleEngine.js';
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
export type { ChatMessage, ToolExecution, ChatContext, ChatEngine } from './types/chat.js';
export type { Thread, ThreadListItem } from './types/thread.js';
export type { ActionProposal, HighlightTarget } from './types/actions.js';
export type { ChatBubbleEvent } from './types/events.js';
export type { ThemeConfig, ThemeTokens } from './types/theme.js';
