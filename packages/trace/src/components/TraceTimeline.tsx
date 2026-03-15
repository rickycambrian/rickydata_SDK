import React, { useMemo, useRef, useEffect } from 'react';
import type { TraceEvent } from '../types.js';
import { darkTokens, injectTraceTheme } from '../theme.js';
import type { TraceThemeTokens } from '../theme.js';

export interface TraceTimelineProps {
  events: TraceEvent[];
  theme?: Partial<TraceThemeTokens>;
  height?: number;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
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

interface TimelineEntry {
  event: TraceEvent;
  x: number; // 0..1 normalized position
}

/**
 * TraceTimeline — compact horizontal timeline showing events as dots/bars.
 * Tool calls with durations render as bars; other events render as dots.
 * Good for embedding in sidebars or compact panels.
 */
export function TraceTimeline({ events, theme, height = 48, className }: TraceTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      injectTraceTheme(containerRef.current, { ...darkTokens, ...theme });
    }
  }, [theme]);

  const entries: TimelineEntry[] = useMemo(() => {
    if (events.length === 0) return [];

    const startMs = new Date(events[0].timestamp).getTime();
    const endMs = new Date(events[events.length - 1].timestamp).getTime();
    const span = Math.max(endMs - startMs, 1);

    return events.map((event) => ({
      event,
      x: (new Date(event.timestamp).getTime() - startMs) / span,
    }));
  }, [events]);

  const dotRadius = 4;
  const lineY = height / 2;
  const padding = 8;

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        background: 'var(--trace-bg)',
        border: '1px solid var(--trace-border)',
        borderRadius: 'var(--trace-radius)',
        fontFamily: 'var(--trace-font-family)',
        overflow: 'hidden',
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* Base timeline line */}
        <line
          x1={padding}
          y1={lineY}
          x2={100 - padding}
          y2={lineY}
          stroke="var(--trace-border)"
          strokeWidth="1"
        />

        {/* Event dots and duration bars */}
        {entries.map(({ event, x }) => {
          const cx = padding + x * (100 - 2 * padding);
          const color = TYPE_COLORS[event.type] ?? 'var(--trace-color-custom)';

          if (event.durationMs && event.durationMs > 0) {
            // Duration bar for timed events
            const startMs = new Date(events[0].timestamp).getTime();
            const endMs = new Date(events[events.length - 1].timestamp).getTime();
            const span = Math.max(endMs - startMs, 1);
            const barWidth = Math.max((event.durationMs / span) * (100 - 2 * padding), 2);

            return (
              <g key={event.id}>
                <rect
                  x={cx}
                  y={lineY - 6}
                  width={barWidth}
                  height={12}
                  rx={2}
                  fill={color}
                  opacity={0.6}
                />
                <title>{`${event.type} (${event.durationMs}ms)`}</title>
              </g>
            );
          }

          return (
            <g key={event.id}>
              <circle cx={cx} cy={lineY} r={dotRadius} fill={color} />
              <title>{event.type}</title>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {events.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '4px 8px',
            flexWrap: 'wrap',
            borderTop: '1px solid var(--trace-border)',
          }}
        >
          {Array.from(new Set(events.map((e) => e.type))).map((type) => (
            <span
              key={type}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '10px',
                color: 'var(--trace-text-muted)',
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: TYPE_COLORS[type] ?? 'var(--trace-color-custom)',
                  display: 'inline-block',
                }}
              />
              {type.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
