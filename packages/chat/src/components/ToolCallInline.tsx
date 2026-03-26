import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ToolExecution } from '@rickydata/react';

// ─── Tool Category System ───────────────────────────────

export function getToolCategory(toolName: string): string {
  const name = (toolName.split('__').pop() || toolName).toLowerCase();
  if (/search|query|find|discover|list_papers|list_entities|list_spaces|list_types|exa_|brave_/.test(name)) return 'search';
  if (/read|get_entity|get_page|get_note|get_space|get_type|get_proposal|get_system/.test(name)) return 'read';
  if (/code_search|ast_symbols|grep|glob|test_impact/.test(name)) return 'code';
  if (/create|publish|propose|write|update|delete|add_values|setup_space|configure/.test(name)) return 'mutation';
  if (/bash|command|execute|run_/.test(name)) return 'command';
  if (/chat|send_message|agent_chat/.test(name)) return 'agent';
  return 'default';
}

export const TOOL_BORDER_COLORS: Record<string, string> = {
  search: 'border-l-blue-500 dark:border-l-blue-400',
  read: 'border-l-gray-400 dark:border-l-gray-500',
  code: 'border-l-green-500 dark:border-l-green-400',
  mutation: 'border-l-amber-500 dark:border-l-amber-400',
  command: 'border-l-emerald-500 dark:border-l-emerald-400',
  agent: 'border-l-purple-500 dark:border-l-purple-400',
  default: 'border-l-gray-300 dark:border-l-gray-600',
};

// ─── Smart Arg Summary ──────────────────────────────────

function getArgSummary(args: unknown): { icon: string; value: string; style: string } {
  if (!args || typeof args !== 'object') return { icon: '', value: '', style: '' };
  const a = args as Record<string, unknown>;
  if (a.command) return { icon: '$', value: String(a.command).slice(0, 80), style: 'text-emerald-500 dark:text-emerald-400 font-mono' };
  if (a.query) return { icon: '\u{1F50D}', value: String(a.query).slice(0, 60), style: 'text-blue-600 dark:text-blue-400' };
  if (a.file_path) return { icon: '\u{1F4C4}', value: String(a.file_path), style: 'text-surface-600 dark:text-surface-300 font-mono' };
  if (a.pattern) return { icon: '\u{1F50E}', value: String(a.pattern).slice(0, 50), style: 'text-green-600 dark:text-green-400 font-mono' };
  if (a.url) return { icon: '\u{1F517}', value: String(a.url).slice(0, 60), style: 'text-blue-500 dark:text-blue-400' };
  if (a.message) return { icon: '\u{1F4AC}', value: String(a.message).slice(0, 60), style: '' };
  if (a.entity_id) return { icon: '\u25C6', value: String(a.entity_id).slice(0, 30), style: 'font-mono' };
  if (a.space_id) return { icon: '\u25C6', value: String(a.space_id).slice(0, 30), style: 'font-mono' };
  return { icon: '', value: '', style: '' };
}

// ─── Component ──────────────────────────────────────────

export interface ToolCallInlineProps {
  tool: ToolExecution;
  /** Auto-expand when scrolled into view (default: true). */
  autoExpand?: boolean;
  /** Start collapsed — used for completed messages where results should be hidden by default. */
  defaultCollapsed?: boolean;
}

export function ToolCallInline({ tool, autoExpand = true, defaultCollapsed = false }: ToolCallInlineProps) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasError = tool.result?.isError;
  const isRunning = !tool.result;
  const displayName = tool.displayName || tool.name.split('__').pop() || tool.name;
  const category = getToolCategory(tool.name);
  const borderColor = TOOL_BORDER_COLORS[category] || TOOL_BORDER_COLORS.default;
  const { icon, value, style } = getArgSummary(tool.args);

  // Auto-expand when scrolled into view — only if not defaultCollapsed
  useEffect(() => {
    if (defaultCollapsed || !autoExpand || !containerRef.current || expanded || isRunning) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setExpanded(true); },
      { threshold: 0.3 },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [autoExpand, defaultCollapsed, expanded, isRunning]);

  const resultContent = tool.result?.content || '';
  const looksLikeMarkdown = resultContent.length > 20 && /^[#|*\-\d]|^\s*\||^\s*[-*]\s/m.test(resultContent.trim());

  return (
    <div ref={containerRef} className={`border-l-2 ${borderColor} pl-3 my-0.5`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 py-1 text-left group/tool"
      >
        {/* Status dot */}
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          isRunning ? 'bg-amber-500 animate-pulse'
          : hasError ? 'bg-red-500'
          : 'bg-emerald-500'
        }`} />

        {/* Tool name */}
        <span className="text-[11px] font-mono text-surface-500 dark:text-surface-400 shrink-0">
          {displayName}
        </span>

        {/* Arg summary */}
        {value && (
          <span className={`text-[11px] truncate flex-1 ${style || 'text-surface-600 dark:text-surface-300'}`}>
            {icon && <span className="mr-1">{icon}</span>}{value}
          </span>
        )}

        {/* Spinner while running */}
        {isRunning && (
          <svg className="w-3 h-3 text-surface-400 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}

        {/* Chevron */}
        <svg
          className={`w-3 h-3 text-surface-400 opacity-0 group-hover/tool:opacity-100 transition-all duration-150 shrink-0 ${expanded ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {expanded && (
        <div className="ml-3.5 mt-0.5 mb-1 space-y-1">
          {/* Full args (no summary available) */}
          {tool.args != null && !value && (
            <pre className="text-[10px] leading-relaxed max-h-24 overflow-auto font-mono text-surface-500 dark:text-surface-400 whitespace-pre-wrap break-all">
              {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
            </pre>
          )}

          {/* Full args as collapsible when one-line summary exists */}
          {tool.args != null && value && typeof tool.args === 'object' && Object.keys(tool.args as object).length > 1 && (
            <details className="group/args">
              <summary className="text-[10px] font-mono text-surface-400 cursor-pointer select-none flex items-center gap-1 hover:text-surface-600 dark:hover:text-surface-300">
                <svg
                  className="w-2.5 h-2.5 transition-transform duration-150 group-open/args:rotate-90"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                all params
              </summary>
              <pre className="mt-0.5 text-[10px] leading-relaxed max-h-24 overflow-auto font-mono text-surface-500 dark:text-surface-400 whitespace-pre-wrap break-all">
                {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
              </pre>
            </details>
          )}

          {/* Tool result */}
          {tool.result && (
            <div className={hasError ? 'text-red-600 dark:text-red-400' : ''}>
              {hasError ? (
                <pre className="text-[10px] leading-relaxed max-h-32 overflow-auto font-mono whitespace-pre-wrap break-all">
                  {resultContent || '(empty)'}
                </pre>
              ) : looksLikeMarkdown ? (
                <div className="text-xs chat-markdown max-h-64 overflow-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {resultContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="text-[10px] leading-relaxed max-h-32 overflow-auto font-mono text-surface-600 dark:text-surface-300 whitespace-pre-wrap break-all">
                  {resultContent || '(empty)'}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
