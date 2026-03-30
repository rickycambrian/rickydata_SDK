import React, { type CSSProperties } from 'react';
import { useWalletBalance } from '../hooks/balance.js';
import { useFreeTierStatus } from '../hooks/free-tier.js';
import { useWalletPlan } from '../hooks/wallet-plan.js';

// ─── Types ──────────────────────────────────────────────────

export interface UsageDashboardProps {
  className?: string;
  style?: CSSProperties;
}

// ─── Design Tokens ──────────────────────────────────────────

const tokens = {
  bg: 'rgba(255,255,255,0.08)',
  text: '#d1d5db',
  textBright: '#f3f4f6',
  textMuted: '#9ca3af',
  green: '#10b981',
  yellow: '#fbbf24',
  red: '#ef4444',
  primary: '#6366f1',
  primaryLight: '#a5b4fc',
  border: 'rgba(255,255,255,0.1)',
  trackBg: 'rgba(255,255,255,0.06)',
  freeBadgeBg: 'rgba(16,185,129,0.15)',
  freeBadgeText: '#34d399',
  byokBadgeBg: 'rgba(99,102,241,0.2)',
  byokBadgeText: '#a5b4fc',
} as const;

// ─── Helpers ────────────────────────────────────────────────

function barColor(pct: number): string {
  if (pct >= 85) return tokens.red;
  if (pct >= 60) return tokens.yellow;
  return tokens.green;
}

// ─── Styles ─────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0',
  backgroundColor: tokens.bg,
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: '13px',
  color: tokens.text,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  padding: '12px 16px',
  fontSize: '14px',
  fontWeight: 600,
  color: tokens.textBright,
  borderBottom: `1px solid ${tokens.border}`,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 16px',
  borderBottom: `1px solid ${tokens.border}`,
  fontSize: '12px',
};

const rowLabelStyle: CSSProperties = {
  color: tokens.textMuted,
};

const rowValueStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: tokens.textBright,
  fontWeight: 500,
};

const badgeBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '9999px',
  fontSize: '10px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const trackStyle: CSSProperties = {
  height: '4px',
  borderRadius: '2px',
  backgroundColor: tokens.trackBg,
  overflow: 'hidden',
  flex: 1,
  maxWidth: '120px',
};

// ─── Component ──────────────────────────────────────────────

/**
 * Usage dashboard card composing balance, free-tier usage, and plan info.
 * Three rows: Plan tier, Balance/Usage bar, Current model.
 * When unauthenticated, shows static fallback values.
 */
export function UsageDashboard({ className, style }: UsageDashboardProps) {
  const { balanceDisplay, isLoading: balanceLoading } = useWalletBalance();
  const { status, loading: freeTierLoading } = useFreeTierStatus();
  const { plan, modelProvider, isLoading: planLoading } = useWalletPlan();

  const isLoading = balanceLoading || freeTierLoading || planLoading;

  const isFreePlan = plan === 'free';
  const used = status?.dailyUsed ?? 0;
  const limit = status?.dailyLimit ?? 100;
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const color = barColor(pct);
  const model = status?.model ?? (isFreePlan ? 'MiniMax-M2.7' : '');

  const planBadgeStyle: CSSProperties = {
    ...badgeBase,
    backgroundColor: isFreePlan ? tokens.freeBadgeBg : tokens.byokBadgeBg,
    color: isFreePlan ? tokens.freeBadgeText : tokens.byokBadgeText,
  };

  const fillStyle: CSSProperties = {
    height: '100%',
    width: `${pct}%`,
    borderRadius: '2px',
    backgroundColor: color,
    transition: 'width 0.3s ease-out, background-color 0.3s ease-out',
  };

  return (
    <div style={{ ...cardStyle, ...style }} className={className}>
      <div style={headerStyle}>Usage</div>

      {/* Row 1: Plan tier */}
      <div style={rowStyle}>
        <span style={rowLabelStyle}>Plan</span>
        <div style={rowValueStyle}>
          <span style={planBadgeStyle}>{plan}</span>
          <span style={{ fontSize: '11px', color: tokens.textMuted }}>{modelProvider}</span>
        </div>
      </div>

      {/* Row 2: Balance / Usage bar */}
      <div style={rowStyle}>
        <span style={rowLabelStyle}>{isFreePlan ? 'Daily Usage' : 'Balance'}</span>
        <div style={rowValueStyle}>
          {isFreePlan ? (
            <>
              <div style={trackStyle}>
                <div style={fillStyle} />
              </div>
              <span style={{ fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
                {used}/{limit}
              </span>
            </>
          ) : (
            <span>{isLoading ? '...' : balanceDisplay}</span>
          )}
        </div>
      </div>

      {/* Row 3: Current model */}
      <div style={{ ...rowStyle, borderBottom: 'none' }}>
        <span style={rowLabelStyle}>Model</span>
        <span style={{ ...rowValueStyle, fontFamily: 'monospace', fontSize: '11px' }}>
          {model || (isLoading ? '...' : 'Not set')}
        </span>
      </div>
    </div>
  );
}
