import React, { useEffect, useRef, useState } from 'react';
import type { TraceEvent } from '../types.js';
import { darkTokens, injectTraceTheme } from '../theme.js';
import type { TraceThemeTokens } from '../theme.js';

export interface TraceViewerProps {
  events: TraceEvent[];
  theme?: Partial<TraceThemeTokens>;
  maxHeight?: string;
  className?: string;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  session_start: 'var(--trace-color-session)',
  session_end: 'var(--trace-color-session)',
  message_sent: 'var(--trace-color-message)',
  message_received: 'var(--trace-color-message)',
  tool_call: 'var(--trace-color-tool)',
  tool_result: 'var(--trace-color-tool)',
  sse_text: 'var(--trace-color-sse)',
  sse_done: 'var(--trace-color-done)',
  error: 'var(--trace-color-error)',
  agent_action: 'var(--trace-color-action)',
  custom: 'var(--trace-color-custom)',
};

function relativeTime(timestamp: string, baseTimestamp?: string): string {
  if (!baseTimestamp) return '0.0s';
  const diff = new Date(timestamp).getTime() - new Date(baseTimestamp).getTime();
  if (diff < 1000) return `${diff}ms`;
  return `+${(diff / 1000).toFixed(1)}s`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function dataSummary(data: Record<string, unknown>): string {
  try {
    return truncate(JSON.stringify(data), 200);
  } catch {
    return '{}';
  }
}

/**
 * TraceViewer — scrollable list of trace events with type badges,
 * relative timestamps, and collapsible detail on click.
 *
 * Styled via CSS custom properties (var(--trace-*)), no Tailwind.
 */
export function TraceViewer({ events, theme, maxHeight = '400px', className }: TraceViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Inject theme tokens
  useEffect(() => {
    if (containerRef.current) {
      injectTraceTheme(containerRef.current, { ...darkTokens, ...theme });
    }
  }, [theme]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [events.length]);

  const baseTimestamp = events[0]?.timestamp;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        maxHeight,
        overflowY: 'auto',
        background: 'var(--trace-bg)',
        border: '1px solid var(--trace-border)',
        borderRadius: 'var(--trace-radius)',
        fontFamily: 'var(--trace-font-family)',
        fontSize: 'var(--trace-font-size)',
        color: 'var(--trace-text)',
      }}
    >
      {events.length === 0 && (
        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--trace-text-muted)' }}>
          No trace events yet
        </div>
      )}
      {events.map((event) => {
        const isExpanded = expandedIds.has(event.id);
        const color = EVENT_TYPE_COLORS[event.type] ?? 'var(--trace-color-custom)';

        return (
          <div
            key={event.id}
            onClick={() => toggleExpand(event.id)}
            style={{
              padding: '6px 10px',
              borderBottom: '1px solid var(--trace-border)',
              cursor: 'pointer',
              background: isExpanded ? 'var(--trace-bg-hover)' : 'transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!isExpanded) e.currentTarget.style.background = 'var(--trace-bg-secondary)';
            }}
            onMouseLeave={(e) => {
              if (!isExpanded) e.currentTarget.style.background = 'transparent';
            }}
          >
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Timestamp */}
              <span
                style={{
                  fontFamily: 'var(--trace-font-mono)',
                  color: 'var(--trace-text-muted)',
                  minWidth: '60px',
                  fontSize: '11px',
                }}
              >
                {relativeTime(event.timestamp, baseTimestamp)}
              </span>

              {/* Type badge */}
              <span
                style={{
                  display: 'inline-block',
                  padding: '1px 6px',
                  borderRadius: '3px',
                  fontSize: '10px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  background: color,
                  color: '#000',
                  minWidth: '70px',
                  textAlign: 'center',
                }}
              >
                {event.type.replace(/_/g, ' ')}
              </span>

              {/* Duration badge */}
              {event.durationMs !== undefined && (
                <span
                  style={{
                    fontFamily: 'var(--trace-font-mono)',
                    color: 'var(--trace-text-secondary)',
                    fontSize: '11px',
                  }}
                >
                  {event.durationMs}ms
                </span>
              )}

              {/* Data summary */}
              <span
                style={{
                  flex: 1,
                  color: 'var(--trace-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {dataSummary(event.data)}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <pre
                style={{
                  marginTop: '6px',
                  padding: '8px',
                  background: 'var(--trace-bg)',
                  border: '1px solid var(--trace-border)',
                  borderRadius: 'var(--trace-radius)',
                  fontFamily: 'var(--trace-font-mono)',
                  fontSize: '11px',
                  color: 'var(--trace-text)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {JSON.stringify(event, null, 2)}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
