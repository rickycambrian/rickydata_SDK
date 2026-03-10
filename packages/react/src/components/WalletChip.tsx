import React, { type CSSProperties } from 'react';

export interface WalletChipProps {
  address: string;
  balanceDisplay?: string;
  displayName?: string;
  onPress?: () => void;
  className?: string;
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  borderRadius: '9999px',
  backgroundColor: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: '12px',
  fontFamily: 'monospace',
  color: '#d1d5db',
  cursor: 'default',
  transition: 'background-color 0.15s',
};

const chipClickable: CSSProperties = {
  ...chipStyle,
  cursor: 'pointer',
};

const balanceBadge: CSSProperties = {
  padding: '1px 6px',
  borderRadius: '9999px',
  backgroundColor: 'rgba(99,102,241,0.2)',
  color: '#a5b4fc',
  fontSize: '11px',
  fontFamily: 'sans-serif',
  fontWeight: 500,
};

function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Compact wallet identity pill with optional balance badge.
 * Pure presentational, inline styles, no framework dependency.
 */
export function WalletChip({ address, balanceDisplay, displayName, onPress, className }: WalletChipProps) {
  const Tag = onPress ? 'button' : 'div';
  const style = onPress ? chipClickable : chipStyle;

  return (
    <Tag
      onClick={onPress}
      style={{ ...style, ...(onPress ? { border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.08)' } : {}) }}
      className={className}
      {...(Tag === 'button' ? { type: 'button' as const } : {})}
    >
      <span>{displayName || truncateAddress(address)}</span>
      {balanceDisplay && <span style={balanceBadge}>{balanceDisplay}</span>}
    </Tag>
  );
}
