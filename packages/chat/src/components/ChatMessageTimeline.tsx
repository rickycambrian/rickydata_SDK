import React, { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { ChatMessage, ToolExecution, ChatImage } from '@rickydata/react';
import { ToolCallInline } from './ToolCallInline.js';
import { ThinkingBlock } from './ThinkingBlock.js';

// ─── Markdown Components ────────────────────────────────

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <div className="relative group/code">
      <pre>{children}</pre>
      <button
        onClick={() => {
          const text = (children as React.ReactElement)?.props?.children;
          if (typeof text === 'string') navigator.clipboard.writeText(text);
        }}
        className="absolute top-2 right-2 p-1 rounded bg-surface-700/50 text-surface-300 opacity-0 group-hover/code:opacity-100 transition-opacity text-xs"
        title="Copy code"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
    </div>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-surface-200/60 dark:border-surface-700/40 my-2">
      <table>{children}</table>
    </div>
  ),
};

// ─── Props ──────────────────────────────────────────────

export interface ChatMessageTimelineProps {
  messages: ChatMessage[];
  /** Whether a response is currently being streamed. */
  sending?: boolean;
  /** Current streaming phase (idle/tools/streaming). */
  streamingPhase?: 'idle' | 'tools' | 'streaming';
  /** Currently active tool names (shown during streaming). */
  activeTools?: string[];
  /** Agent display name shown in role labels (default: "agent"). */
  agentName?: string;
  /** Message shown when there are no messages. */
  emptyMessage?: string;
  /** Whether messages are loading (e.g., resuming session). */
  loading?: boolean;
}

export function ChatMessageTimeline({
  messages,
  sending = false,
  streamingPhase = 'idle',
  activeTools = [],
  agentName = 'agent',
  emptyMessage = 'Type a message to begin',
  loading = false,
}: ChatMessageTimelineProps) {
  const endRef = useRef<HTMLDivElement>(null);
  // Auto-scroll removed — users control their own scroll position

  if (loading) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center text-center text-surface-400">
        <div>
          <svg className="w-6 h-6 mx-auto mb-3 animate-spin text-primary-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm font-mono">Restoring session...</p>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center text-center">
        <div className="max-w-sm">
          <div className="w-10 h-10 mx-auto mb-4 rounded-xl bg-primary-500/10 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 8V4H8" /><rect x="8" y="8" width="8" height="8" rx="1" /><path d="M12 16v4h4" />
            </svg>
          </div>
          <p className="text-surface-700 dark:text-surface-300 font-medium">{agentName}</p>
          <p className="text-xs text-surface-400 mt-3">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
      <div className="space-y-1 max-w-3xl mx-auto">
        {messages.map((msg, msgIdx) => {
          const isStreaming = msg.id.startsWith('agent-streaming-');
          const isLastAgent = msg.role === 'agent' && msgIdx === messages.length - 1;

          return (
            <div key={msg.id} className="group/msg">
              {/* Role label row */}
              <div className={`flex items-center gap-2 py-1.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'agent' && (
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isStreaming ? 'bg-primary-500 animate-pulse' : 'bg-primary-500/60'}`} />
                )}
                <span className={`text-[11px] font-mono uppercase tracking-wider ${
                  msg.role === 'user' ? 'text-surface-400' : 'text-primary-500/70'
                }`}>
                  {msg.role === 'user' ? 'you' : agentName.toLowerCase().split(' ').slice(0, 2).join(' ')}
                </span>
                {msg.costUSD && (
                  <span className="text-[10px] font-mono text-surface-400">{msg.costUSD}</span>
                )}
              </div>

              {/* Content area */}
              <div className={msg.role === 'user' ? 'pl-4 sm:pl-8' : 'pl-4 sm:pl-5'}>
                {/* User images */}
                {msg.role === 'user' && msg.images && msg.images.length > 0 && (
                  <div className="flex gap-1.5 mb-2 flex-wrap justify-end">
                    {msg.images.map((img: ChatImage, i: number) => (
                      <img key={i} src={img.preview} alt={`Attached ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-surface-200 dark:border-surface-700" />
                    ))}
                  </div>
                )}

                {/* Thinking block */}
                {msg.role === 'agent' && msg.thinking && (
                  <ThinkingBlock content={msg.thinking} />
                )}

                {/* Tool executions — inline, before text */}
                {msg.role === 'agent' && msg.toolExecutions && msg.toolExecutions.length > 0 && (
                  <div className="mb-2 space-y-0.5">
                    {msg.toolExecutions.map((tool: ToolExecution) => (
                      <ToolCallInline key={tool.id} tool={tool} />
                    ))}
                  </div>
                )}

                {/* Message text */}
                {msg.content && (
                  <div className={
                    msg.role === 'user'
                      ? 'text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap leading-relaxed'
                      : 'chat-markdown text-sm leading-relaxed text-surface-800 dark:text-surface-200'
                  }>
                    {msg.role === 'user' ? (
                      <p>{msg.content}</p>
                    ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    )}
                    {/* Streaming cursor */}
                    {isStreaming && isLastAgent && sending && streamingPhase === 'streaming' && (
                      <span className="inline-block w-1.5 h-4 bg-primary-500 ml-0.5 -mb-0.5 animate-pulse rounded-sm" />
                    )}
                  </div>
                )}
              </div>

              {/* Separator line between messages */}
              {msgIdx < messages.length - 1 && (
                <div className="border-b border-surface-100 dark:border-surface-800/50 my-2 ml-4 sm:ml-5" />
              )}
            </div>
          );
        })}

        {/* Active streaming indicator — only show when there's no streaming message yet */}
        {sending && streamingPhase !== 'streaming' && !messages.some(m => m.id.startsWith('agent-streaming-')) && (
          <div className="group/msg">
            <div className="flex items-center gap-2 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse shrink-0" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-primary-500/70">
                {agentName.toLowerCase().split(' ').slice(0, 2).join(' ')}
              </span>
            </div>
            <div className="pl-4 sm:pl-5">
              <div className="flex items-center gap-2 text-sm text-surface-400">
                <span className="inline-block w-1.5 h-4 bg-surface-300 dark:bg-surface-600 animate-pulse rounded-sm" />
                <span className="text-xs font-mono">thinking</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div ref={endRef} />
    </div>
  );
}
