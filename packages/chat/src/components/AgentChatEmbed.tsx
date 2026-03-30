import React, { useCallback, useRef, useEffect, type CSSProperties } from 'react';
import { useAgentChat } from '@rickydata/react';
import type { ChatMessage as ReactChatMessage } from '@rickydata/react';
import { ChatMessageList } from './ChatMessageList.js';
import { ChatInputBar } from './ChatInputBar.js';
import { darkTokens, lightTokens } from '../theme/tokens.js';
import { injectThemeTokens } from '../theme/inject.js';
import type { ThemeConfig } from '../types/theme.js';
import type { ChatMessage } from '../types/chat.js';

// ─── Types ──────────────────────────────────────────────────

export interface AgentChatEmbedProps {
  /** Agent ID to chat with (e.g. "erc8004-expert"). */
  agentId: string;
  /** Model override (defaults to "haiku"). */
  model?: string;
  /** Max height of the embed container. Defaults to "500px". */
  maxHeight?: string;
  /** Title shown in the compact header. Defaults to agent ID. */
  title?: string;
  /** Placeholder text for the input bar. */
  placeholder?: string;
  /** Theme configuration (preset + token overrides). */
  theme?: ThemeConfig;
  className?: string;
  style?: CSSProperties;
}

// ─── Helpers ────────────────────────────────────────────────

/** Map @rickydata/react ChatMessage to @rickydata/chat ChatMessage format. */
function toChatMessage(msg: ReactChatMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content || '',
    toolExecutions: msg.toolExecutions?.map((t) => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName ?? t.name.split('__').pop() ?? t.name,
      args: t.args,
      result: t.result ? { content: t.result.content ?? '', isError: t.result.isError } : undefined,
    })),
  };
}

// ─── Styles ─────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  borderRadius: 'var(--chat-radius-lg, 10px)',
  border: '1px solid var(--chat-border, #333333)',
  backgroundColor: 'var(--chat-bg-secondary, #1a1a1a)',
  fontFamily: 'var(--chat-font-family, system-ui, -apple-system, sans-serif)',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  borderBottom: '1px solid var(--chat-border, #333333)',
  backgroundColor: 'var(--chat-bg, #0f0f0f)',
};

const titleStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--chat-text, #f5f5f5)',
  margin: 0,
};

const newChatBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '11px',
  fontFamily: 'var(--chat-font-family, system-ui, -apple-system, sans-serif)',
  color: 'var(--chat-text-muted, #737373)',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: '4px',
  transition: 'color 150ms ease',
};

const emptyStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
};

const emptyTextStyle: CSSProperties = {
  fontSize: 'var(--chat-font-size, 12px)',
  color: 'var(--chat-text-muted, #737373)',
  margin: 0,
};

// ─── Component ──────────────────────────────────────────────

/**
 * Inline (non-floating) agent chat embed.
 * Uses position: relative and fills its parent — no fixed/floating positioning.
 * Pre-configured for a specific agent via agentId prop.
 * Reuses ChatMessageList + ChatInputBar as building blocks.
 */
export function AgentChatEmbed({
  agentId,
  model,
  maxHeight = '500px',
  title,
  placeholder,
  theme,
  className,
  style,
}: AgentChatEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    messages: rawMessages,
    messagesLoading,
    sending,
    sendMessage,
    clearChat,
    streamingPhase,
  } = useAgentChat({ agentId, model });

  // Inject theme tokens into the container element
  useEffect(() => {
    if (!containerRef.current) return;
    const base = theme?.preset === 'light' ? lightTokens : darkTokens;
    injectThemeTokens(containerRef.current, { ...base, ...theme?.tokens });
  }, [theme]);

  // Adapt messages from @rickydata/react format to @rickydata/chat format
  const messages: ChatMessage[] = rawMessages.map(toChatMessage);
  const streaming = streamingPhase !== 'idle';

  // Input state
  const [input, setInput] = React.useState('');

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    sendMessage(text).catch(() => undefined);
  }, [input, sendMessage]);

  const handleNewChat = useCallback(() => {
    clearChat();
    setInput('');
  }, [clearChat]);

  const displayTitle = title ?? agentId;

  return (
    <div
      ref={containerRef}
      style={{ ...containerStyle, maxHeight, ...style }}
      className={className}
    >
      {/* Compact header */}
      <div style={headerStyle}>
        <h4 style={titleStyle}>{displayTitle}</h4>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={sending}
          style={{
            ...newChatBtnStyle,
            opacity: sending ? 0.4 : 1,
            cursor: sending ? 'default' : 'pointer',
          }}
          title="Start a new conversation"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New
        </button>
      </div>

      {/* Messages area */}
      {messagesLoading ? (
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>Loading...</p>
        </div>
      ) : (
        <ChatMessageList
          messages={messages}
          streaming={streaming}
        />
      )}

      {/* Input bar */}
      <ChatInputBar
        value={input}
        onChange={setInput}
        onSend={handleSend}
        disabled={sending}
        placeholder={placeholder ?? `Ask ${displayTitle}...`}
      />
    </div>
  );
}
