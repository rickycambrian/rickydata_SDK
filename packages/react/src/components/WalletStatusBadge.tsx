import React, { type CSSProperties } from 'react';
import { useWalletBalance } from '../hooks/balance.js';

// ─── Types ──────────────────────────────────────────────────

export interface WalletStatusBadgeProps {
  /** Wallet address. When provided, badge shows "Connected". When absent, shows "Connect Wallet". */
  address?: string | null;
  /** Override connected state (e.g. from an external wallet provider). */
  connected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

// ─── Design Tokens ──────────────────────────────────────────

const tokens = {
  bg: 'rgba(255,255,255,0.08)',
  bgHover: 'rgba(255,255,255,0.12)',
  text: '#d1d5db',
  textMuted: '#9ca3af',
  green: '#10b981',
  red: '#ef4444',
  border: 'rgba(255,255,255,0.1)',
} as const;

// ─── Helpers ────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Styles ─────────────────────────────────────────────────

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 12px',
  borderRadius: '9999px',
  backgroundColor: tokens.bg,
  border: `1px solid ${tokens.border}`,
  fontSize: '12px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  color: tokens.text,
  cursor: 'default',
  transition: 'background-color 0.15s',
};

const pillClickable: CSSProperties = {
  ...pillStyle,
  cursor: 'pointer',
};

const dotStyle = (connected: boolean): CSSProperties => ({
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  backgroundColor: connected ? tokens.green : tokens.red,
  flexShrink: 0,
});

const addressStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '11px',
  color: tokens.textMuted,
};

// ─── Component ──────────────────────────────────────────────

/**
 * Compact wallet status pill.
 * Connected: green dot + "Connected" + truncated address.
 * Disconnected: red dot + "Connect Wallet".
 */
export function WalletStatusBadge({
  address,
  connected: connectedProp,
  onClick,
  className,
  style,
}: WalletStatusBadgeProps) {
  const { depositAddress } = useWalletBalance({ enabled: !!address });

  const resolvedAddress = address ?? depositAddress ?? null;
  const isConnected = connectedProp ?? !!resolvedAddress;

  const Tag = onClick ? 'button' : 'div';
  const baseStyle = onClick ? pillClickable : pillStyle;

  return (
    <Tag
      onClick={onClick}
      style={{ ...baseStyle, ...style }}
      className={className}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
    >
      <div style={dotStyle(isConnected)} />
      <span>{isConnected ? 'Connected' : 'Connect Wallet'}</span>
      {isConnected && resolvedAddress && (
        <span style={addressStyle}>{truncateAddress(resolvedAddress)}</span>
      )}
    </Tag>
  );
}
