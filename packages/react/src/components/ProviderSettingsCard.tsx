import React, { type CSSProperties } from 'react';
import { useWalletSettings } from '../hooks/wallet-settings.js';
import { useWalletPlan } from '../hooks/wallet-plan.js';

// ─── Types ──────────────────────────────────────────────────

export interface ProviderSettingsCardProps {
  /** Override provider display (for controlled usage). */
  provider?: string;
  model?: string;
  plan?: 'free' | 'byok';
  className?: string;
  style?: CSSProperties;
}

// ─── Design Tokens ──────────────────────────────────────────

const tokens = {
  bg: 'rgba(255,255,255,0.08)',
  text: '#d1d5db',
  textBright: '#f3f4f6',
  textMuted: '#9ca3af',
  primary: '#6366f1',
  primaryLight: '#a5b4fc',
  border: 'rgba(255,255,255,0.1)',
  freeBadgeBg: 'rgba(16,185,129,0.15)',
  freeBadgeText: '#34d399',
  byokBadgeBg: 'rgba(99,102,241,0.2)',
  byokBadgeText: '#a5b4fc',
} as const;

// ─── Styles ─────────────────────────────────────────────────

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '14px 16px',
  backgroundColor: tokens.bg,
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: '13px',
  color: tokens.text,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: tokens.textBright,
  margin: 0,
};

const badgeBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '2px 8px',
  borderRadius: '9999px',
  fontSize: '11px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 8px',
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderRadius: '6px',
  fontSize: '12px',
};

const rowLabelStyle: CSSProperties = {
  color: tokens.textMuted,
};

const rowValueStyle: CSSProperties = {
  color: tokens.textBright,
  fontWeight: 500,
};

// ─── Component ──────────────────────────────────────────────

/**
 * Read-only card showing current AI provider, model, and plan badge.
 * When unauthenticated, shows default "MiniMax / Free" display.
 */
export function ProviderSettingsCard({
  provider: providerProp,
  model: modelProp,
  plan: planProp,
  className,
  style,
}: ProviderSettingsCardProps) {
  const { settings } = useWalletSettings();
  const { plan: hookPlan, modelProvider: hookProvider } = useWalletPlan();

  const plan = planProp ?? hookPlan ?? 'free';
  const provider = providerProp ?? hookProvider ?? settings?.modelProvider ?? 'minimax';
  const model = modelProp ?? settings?.defaultModel ?? (plan === 'free' ? 'MiniMax-M2.7' : '');

  const isFreePlan = plan === 'free';
  const planBadgeStyle: CSSProperties = {
    ...badgeBase,
    backgroundColor: isFreePlan ? tokens.freeBadgeBg : tokens.byokBadgeBg,
    color: isFreePlan ? tokens.freeBadgeText : tokens.byokBadgeText,
  };

  return (
    <div style={{ ...cardStyle, ...style }} className={className}>
      <div style={headerStyle}>
        <h4 style={titleStyle}>Provider Settings</h4>
        <span style={planBadgeStyle}>{plan}</span>
      </div>
      <div style={rowStyle}>
        <span style={rowLabelStyle}>Provider</span>
        <span style={rowValueStyle}>{provider}</span>
      </div>
      {model && (
        <div style={rowStyle}>
          <span style={rowLabelStyle}>Model</span>
          <span style={rowValueStyle}>{model}</span>
        </div>
      )}
    </div>
  );
}
