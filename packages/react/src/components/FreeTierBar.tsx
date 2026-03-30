import React, { type CSSProperties } from 'react';
import { useFreeTierStatus } from '../hooks/free-tier.js';

// ─── Types ──────────────────────────────────────────────────

export interface FreeTierBarProps {
  /** Override hook-provided status (for controlled / storybook usage). */
  used?: number;
  limit?: number;
  resetsAt?: string;
  /** Disable automatic data fetching via hook. */
  enabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

// ─── Design Tokens ──────────────────────────────────────────

const tokens = {
  bg: 'rgba(255,255,255,0.08)',
  text: '#d1d5db',
  textMuted: '#9ca3af',
  green: '#10b981',
  yellow: '#fbbf24',
  red: '#ef4444',
  border: 'rgba(255,255,255,0.1)',
  trackBg: 'rgba(255,255,255,0.06)',
} as const;

// ─── Helpers ────────────────────────────────────────────────

function barColor(pct: number): string {
  if (pct >= 85) return tokens.red;
  if (pct >= 60) return tokens.yellow;
  return tokens.green;
}

function formatResetTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ─── Styles ─────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '12px 14px',
  backgroundColor: tokens.bg,
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: '13px',
  color: tokens.text,
  lineHeight: '1.4',
};

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const labelStyle: CSSProperties = {
  fontWeight: 500,
  fontSize: '12px',
  color: tokens.text,
};

const countStyle: CSSProperties = {
  fontSize: '12px',
  color: tokens.textMuted,
  fontVariantNumeric: 'tabular-nums',
};

const trackStyle: CSSProperties = {
  height: '6px',
  borderRadius: '3px',
  backgroundColor: tokens.trackBg,
  overflow: 'hidden',
};

const tooltipStyle: CSSProperties = {
  fontSize: '11px',
  color: tokens.textMuted,
  lineHeight: '1.3',
};

// ─── Component ──────────────────────────────────────────────

/**
 * Horizontal progress bar showing daily free-tier usage.
 * Color transitions: green (0-60%), yellow (60-85%), red (85-100%).
 * When unauthenticated, shows static "100 free requests/day" text.
 */
export function FreeTierBar({
  used: usedProp,
  limit: limitProp,
  resetsAt: resetsAtProp,
  enabled,
  className,
  style,
}: FreeTierBarProps) {
  const { status, loading } = useFreeTierStatus({ enabled });

  // Prefer props, then hook data
  const used = usedProp ?? status?.dailyUsed ?? 0;
  const limit = limitProp ?? status?.dailyLimit ?? 100;
  const resetsAt = resetsAtProp ?? status?.resetsAt ?? '';

  // Unauthenticated: no status and not loading
  const isUnauth = !status && !loading && usedProp === undefined;

  if (isUnauth) {
    return (
      <div style={{ ...containerStyle, ...style }} className={className}>
        <span style={labelStyle}>100 free requests/day</span>
      </div>
    );
  }

  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = barColor(pct);

  const fillStyle: CSSProperties = {
    height: '100%',
    width: `${pct}%`,
    borderRadius: '3px',
    backgroundColor: color,
    transition: 'width 0.3s ease-out, background-color 0.3s ease-out',
  };

  const tooltipText = `Each chat message = 1 request. MCP tool calls count as 0.25 each.${
    resetsAt ? ` Resets at ${formatResetTime(resetsAt)}` : ''
  }`;

  return (
    <div style={{ ...containerStyle, ...style }} className={className} title={tooltipText}>
      <div style={headerRow}>
        <span style={labelStyle}>Free Tier Usage</span>
        <span style={countStyle}>
          {used} / {limit}
        </span>
      </div>
      <div style={trackStyle}>
        <div style={fillStyle} />
      </div>
      {resetsAt && (
        <span style={tooltipStyle}>
          Resets at {formatResetTime(resetsAt)}
        </span>
      )}
    </div>
  );
}
