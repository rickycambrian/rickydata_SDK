import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface ThinkingBlockProps {
  /** The thinking/reasoning text to display. */
  content: string;
  /** Whether the details element starts open (default: false). */
  defaultOpen?: boolean;
  /** Label shown on the summary line (default: "thinking"). */
  label?: string;
}

/**
 * Collapsible block for agent thinking/reasoning text.
 * Uses a native `<details>` element with indigo left-border styling.
 * Ported from marketplace AgentChat.tsx.
 */
export function ThinkingBlock({ content, defaultOpen = false, label = 'thinking' }: ThinkingBlockProps) {
  if (!content) return null;

  return (
    <details
      open={defaultOpen || undefined}
      className="group/think border-l-2 border-l-indigo-400 dark:border-l-indigo-500 pl-3 my-1 mb-2"
    >
      <summary className="text-[11px] font-mono text-indigo-500 dark:text-indigo-400 cursor-pointer select-none flex items-center gap-1 list-none">
        <svg
          className="w-2.5 h-2.5 transition-transform duration-150 group-open/think:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        {label}
      </summary>
      <div className="mt-1 text-xs text-surface-500 dark:text-surface-400 chat-markdown max-h-48 overflow-auto leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    </details>
  );
}
