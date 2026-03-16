import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { AgentClient, type AgentClientConfig } from 'rickydata/agent';
import type { WalletAdapter } from '../types/wallet.js';
import type { ThemeConfig } from '../types/theme.js';
import type { ChatContext, ChatMessage, ChatEngine } from '../types/chat.js';
import type { ActionProposal } from '../types/actions.js';
import type { ChatBubbleEvent } from '../types/events.js';
import { darkTokens, lightTokens } from '../theme/tokens.js';
import { injectThemeTokens } from '../theme/inject.js';

export interface ChatBubbleCallbacks {
  /** Called when the agent proposes an action for confirmation. */
  onAction?: (proposal: ActionProposal) => Promise<{ confirmed: boolean; revalidateKeys?: string[] }>;
  /** Called when the agent requests navigation. */
  onNavigate?: (path: string) => void;
  /** Called after an action completes to refresh data. */
  onRevalidate?: (keys: string[]) => void;
  /** Called on every SSE event for custom handling. */
  onCustomEvent?: (event: ChatBubbleEvent) => void;
  /** Resolve the current page context for contextual chat. */
  getPageContext?: () => ChatContext | null;
  /** Render content for custom mode tabs (e.g. 'traces'). */
  renderCustomMode?: (mode: string) => React.ReactNode;
}

export interface ChatBubbleConfig {
  /** The agent ID to chat with. */
  agentId: string;
  /** Model to use (default: 'haiku'). */
  model?: 'haiku' | 'sonnet' | 'opus';
  /** Wallet adapter for auth. */
  wallet: WalletAdapter;
  /** Gateway URL override. */
  gatewayUrl?: string;
  /** Pre-built AgentClient (skips auto-creation). */
  client?: AgentClient;
  /** Theme configuration. */
  theme?: ThemeConfig;
  /** Chat bubble title. */
  title?: string;
  /** Available mode tabs. */
  modes?: ('chat' | 'voice' | 'threads' | 'traces')[];
  /** Callbacks. */
  callbacks?: ChatBubbleCallbacks;
  /** External chat engine — bypasses built-in useChatBubbleEngine when provided. */
  engine?: ChatEngine;
}

interface ChatBubbleContextValue {
  client: AgentClient;
  config: ChatBubbleConfig;
}

const ChatBubbleContext = createContext<ChatBubbleContextValue | null>(null);

export interface ChatBubbleProviderProps {
  config: ChatBubbleConfig;
  children: ReactNode;
}

export function ChatBubbleProvider({ config, children }: ChatBubbleProviderProps) {
  const themeRef = useRef<HTMLDivElement>(null);

  const client = useMemo(() => {
    if (config.client) return config.client;

    const wallet = config.wallet;
    const opts: AgentClientConfig = {
      gatewayUrl: config.gatewayUrl,
      tokenGetter: async () => {
        // The useWalletAuth hook manages the actual token.
        // This getter is a fallback — the engine passes tokens directly.
        return undefined;
      },
    };
    return new AgentClient(opts);
  }, [config.client, config.gatewayUrl, config.wallet]);

  const value = useMemo<ChatBubbleContextValue>(
    () => ({ client, config }),
    [client, config],
  );

  // Resolve theme tokens
  const resolvedTokens = useMemo(() => {
    const preset = config.theme?.preset ?? 'dark';
    const base = preset === 'light' ? lightTokens : darkTokens;
    return { ...base, ...config.theme?.tokens };
  }, [config.theme]);

  return (
    <ChatBubbleContext.Provider value={value}>
      <div
        ref={themeRef}
        style={resolvedTokens as React.CSSProperties}
      >
        {children}
      </div>
    </ChatBubbleContext.Provider>
  );
}

/** Access the ChatBubble config and client from context. */
export function useChatBubbleConfig(): ChatBubbleContextValue {
  const ctx = useContext(ChatBubbleContext);
  if (!ctx) {
    throw new Error('useChatBubbleConfig must be used within a <ChatBubbleProvider>');
  }
  return ctx;
}
