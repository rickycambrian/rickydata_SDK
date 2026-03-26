import React, { useState } from 'react';
import type { ChatMessage, ChatImage, ToolApprovalData, TransactionSigningData } from '@rickydata/react';
import { ChatMessageTimeline } from './ChatMessageTimeline.js';
import { ChatInputTimeline } from './ChatInputTimeline.js';

// ─── Types ───────────────────────────────────────────────

export interface ChatPageAgentInfo {
  id: string;
  title: string;
  slug: string;
  description?: string;
}

export interface ChatPageModelOption {
  id: string;
  label: string;
  provider?: string;
}

export interface ChatPageProps {
  /** Messages to display. */
  messages: ChatMessage[];
  /** Whether a message is currently being sent. */
  sending?: boolean;
  /** Current streaming phase. */
  streamingPhase?: 'idle' | 'tools' | 'streaming';
  /** Currently active tool names during streaming. */
  activeTools?: string[];
  /** Whether the input should be disabled (e.g. no API key). */
  inputDisabled?: boolean;
  /** Placeholder text for the input. */
  inputPlaceholder?: string;
  /** Whether messages are loading (e.g. resuming session). */
  messagesLoading?: boolean;
  /** Called when the user sends a message. */
  onSend: (text: string, options?: { images?: ChatImage[] }) => void;
  /** Pending tool approval (if any). Render your own approval UI based on this. */
  pendingApproval?: ToolApprovalData | null;
  /** Pending transaction signing (if any). Render your own signing UI. */
  pendingTransaction?: TransactionSigningData | null;
  /** Total session cost in USD. */
  totalCost?: number;

  // ─── Sidebar: Agent ────
  /** Agent metadata for the sidebar. */
  agent?: ChatPageAgentInfo;
  /** Agent display name (fallback when agent prop is not provided). */
  agentName?: string;

  // ─── Sidebar: Model ────
  /** Currently selected model ID. */
  selectedModel?: string;
  /** Callback when model changes. */
  onModelChange?: (modelId: string) => void;
  /** Available model options. */
  modelOptions?: ChatPageModelOption[];
  /** Whether the model selector is locked (e.g. mid-session). */
  modelLocked?: boolean;

  // ─── Sidebar: Slots ────
  /** Render banners above the chat area (free tier, deposit, auth warnings). */
  renderBanners?: () => React.ReactNode;
  /** Render actions at the bottom of the sidebar (settings, report issue, etc.). */
  renderSidebarActions?: () => React.ReactNode;
  /** Render session info in the sidebar (balance, plan, cost). */
  renderSessionInfo?: () => React.ReactNode;
  /** Render mode switcher in the sidebar (e.g. Text / Voice toggle). */
  renderModeSwitcher?: () => React.ReactNode;
  /** Render a custom model/provider selector, replacing the built-in model dropdown. */
  renderModelSection?: () => React.ReactNode;

  // ─── Layout Slots ────
  /** Optional header slot (above the timeline, inside the chat area). */
  header?: React.ReactNode;
  /** Optional footer slot (below the input). */
  footer?: React.ReactNode;

  // ─── Navigation ────
  /** Called when the user clicks the close/back button. */
  onClose?: () => void;

  // ─── Children Override ────
  /**
   * When provided, replaces the built-in ChatMessageTimeline + ChatInputTimeline.
   * Useful for incremental migration: render your existing chat component inside the sidebar layout.
   */
  children?: React.ReactNode;
}

/**
 * Full-page chat layout with collapsible sidebar + ChatMessageTimeline + ChatInputTimeline.
 * Designed for the marketplace-style full-page agent chat experience.
 *
 * When `agent` prop is provided, a sidebar is rendered with agent identity,
 * model selector, session info, and action slots.
 * When `agent` is omitted, renders a simple full-width layout with optional header/footer.
 *
 * Use with the `useAgentChat` hook from `@rickydata/react`:
 *
 * ```tsx
 * const chat = useAgentChat({ agentId: 'my-agent' });
 * <ChatPage
 *   agent={{ id: 'my-agent', title: 'My Agent', slug: 'my-agent' }}
 *   messages={chat.messages}
 *   sending={chat.sending}
 *   streamingPhase={chat.streamingPhase}
 *   activeTools={chat.activeTools}
 *   onSend={chat.sendMessage}
 *   totalCost={chat.totalCost}
 * />
 * ```
 */
export function ChatPage({
  messages,
  sending = false,
  streamingPhase = 'idle',
  activeTools = [],
  inputDisabled = false,
  inputPlaceholder,
  messagesLoading = false,
  onSend,
  pendingApproval,
  pendingTransaction,
  totalCost = 0,
  agent,
  agentName,
  selectedModel,
  onModelChange,
  modelOptions = [],
  modelLocked = false,
  renderBanners,
  renderSidebarActions,
  renderSessionInfo,
  renderModeSwitcher,
  renderModelSection,
  header,
  footer,
  onClose,
  children,
}: ChatPageProps) {
  const displayName = agent?.title ?? agentName ?? 'agent';
  const shortName = displayName.toLowerCase().split(' ').slice(0, 2).join(' ');
  const hasSidebar = !!agent;

  const chatArea = (
    <div className="flex-1 flex flex-col min-w-0 relative">
      {/* Optional header */}
      {header}

      {children ? (
        /* When children provided, render them instead of built-in timeline+input */
        <>{children}</>
      ) : (
        <>
          {/* Banners slot */}
          {renderBanners?.()}

          {/* Message timeline */}
          <ChatMessageTimeline
            messages={messages}
            sending={sending}
            streamingPhase={streamingPhase}
            activeTools={activeTools}
            agentName={displayName}
            loading={messagesLoading}
          />

          {/* Tool approval overlay */}
          {pendingApproval && (
            <div className="px-4 sm:px-6 py-2 border-t border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="max-w-3xl mx-auto flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <path d="M12 9v4" /><path d="M12 17h.01" />
                </svg>
                <span className="font-mono">
                  Tool approval required: <strong>{pendingApproval.toolName}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Transaction signing overlay */}
          {pendingTransaction && (
            <div className="px-4 sm:px-6 py-2 border-t border-blue-200/60 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="max-w-3xl mx-auto flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M12 12h.01" />
                </svg>
            <span className="font-mono">
              Transaction signing: <strong>{pendingTransaction.description}</strong>
            </span>
          </div>
        </div>
      )}

          {/* Input area */}
          <ChatInputTimeline
            onSend={onSend}
            disabled={inputDisabled}
            sending={sending}
            placeholder={inputPlaceholder}
          />

          {/* Optional footer */}
          {footer}
        </>
      )}
    </div>
  );

  // ─── Simple layout (no sidebar) ────
  if (!hasSidebar) {
    return (
      <div className="flex flex-col h-full w-full bg-white dark:bg-surface-950 overflow-hidden">
        {chatArea}
      </div>
    );
  }

  // ─── Full layout with sidebar ────
  return (
    <div className="h-full flex animate-fade-in">
      {/* Sidebar */}
      <aside
        className="w-72 flex-shrink-0 border-r border-surface-200 dark:border-surface-800 bg-surface-50/80 dark:bg-surface-900/80 backdrop-blur-sm flex flex-col overflow-hidden"
      >
        <div className="w-72 flex flex-col h-full">
          {/* Agent identity */}
          <div className="p-5 pb-4">
            <h1 className="text-base font-semibold text-surface-900 dark:text-surface-50 leading-tight">
              {agent.title}
            </h1>
          </div>

          {/* Mode switcher slot */}
          {renderModeSwitcher && (
            <>
              <div className="mx-5">{renderModeSwitcher()}</div>
              <div className="mx-5 mt-3 border-t border-surface-200 dark:border-surface-800" />
            </>
          )}

          {/* Model selector — custom slot or built-in */}
          {renderModelSection ? (
            <>
              <div className="p-5 space-y-3">{renderModelSection()}</div>
              <div className="mx-5 border-t border-surface-200 dark:border-surface-800" />
            </>
          ) : modelOptions.length > 0 ? (
            <>
              <div className="p-5 space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-surface-500 uppercase tracking-wider mb-1.5 block">
                    Model
                  </label>
                  <div className="relative">
                    <select
                      value={selectedModel}
                      onChange={e => onModelChange?.(e.target.value)}
                      disabled={modelLocked}
                      className="w-full text-sm pl-3 pr-8 py-2 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {modelOptions.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    <svg className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </div>
                {modelLocked && (
                  <p className="text-[11px] text-surface-400 flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Locked for this session
                  </p>
                )}
              </div>
              <div className="mx-5 border-t border-surface-200 dark:border-surface-800" />
            </>
          ) : null}

          {/* Session info */}
          <div className="p-5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-500">Messages</span>
              <span className="text-xs font-medium text-surface-700 dark:text-surface-300 tabular-nums">
                {messages.length}
              </span>
            </div>
            {totalCost > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-500">Session cost</span>
                <span className="text-xs font-medium text-surface-700 dark:text-surface-300 flex items-center gap-1 tabular-nums">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  {totalCost.toFixed(4)}
                </span>
              </div>
            )}
            {renderSessionInfo?.()}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Sidebar actions */}
          <div className="p-5 pt-3 space-y-1.5 border-t border-surface-200 dark:border-surface-800">
            {renderSidebarActions?.()}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 19-7-7 7-7M19 12H5" />
                </svg>
                Back to Agent
              </button>
            )}
          </div>
        </div>
      </aside>

      {chatArea}
    </div>
  );
}
