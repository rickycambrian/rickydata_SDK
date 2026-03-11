import React, { useState, type CSSProperties } from 'react';

// ─── Types ──────────────────────────────────────────────────

export type DepositStatus = 'idle' | 'switching' | 'signing' | 'pending' | 'confirmed' | 'error';

export interface DepositPanelProps {
  depositAddress: string;
  balanceDisplay?: string;
  depositInstructions?: {
    network?: string;
    chainId?: number;
    chainName?: string;
    token?: string;
    tokenAddress?: string;
    decimals?: number;
    warning?: string;
  };
  isWalletOnBase?: boolean;
  depositStatus?: DepositStatus;
  depositError?: string | null;
  depositResult?: string | null;
  onSwitchToBase?: () => void;
  onAddUsdcAsset?: () => void;
  onDeposit?: (amountUsdc: string) => void;
  onAddressCopied?: () => void;
  onRefreshBalance?: () => void;
  onClose?: () => void;
  className?: string;
  recoveryPolicyUrl?: string;
}

// ─── Design Tokens ──────────────────────────────────────────

const tokens = {
  bg: 'rgba(255,255,255,0.08)',
  bgHover: 'rgba(255,255,255,0.12)',
  text: '#d1d5db',
  textMuted: '#9ca3af',
  primary: '#6366f1',
  primaryLight: '#a5b4fc',
  success: '#10b981',
  error: '#f87171',
  warning: '#fcd34d',
  border: 'rgba(255,255,255,0.1)',
} as const;

// Unicode icons
const ICON_COPY = '\u2398';
const ICON_CHECK = '\u2713';
const ICON_WARNING = '\u26A0';
const ICON_EXTERNAL = '\u2197';
const ICON_CLOSE = '\u2715';

// ─── Styles ─────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  backgroundColor: tokens.bg,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '16px',
  color: tokens.text,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: '14px',
  lineHeight: '1.5',
  maxWidth: '420px',
  width: '100%',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '12px',
};

const titleStyle: CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#f3f4f6',
  margin: 0,
};

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '9999px',
  backgroundColor: 'rgba(99,102,241,0.2)',
  color: tokens.primaryLight,
  fontSize: '11px',
  fontWeight: 500,
};

const closeButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: tokens.textMuted,
  cursor: 'pointer',
  fontSize: '16px',
  padding: '4px',
  lineHeight: 1,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 10px',
  backgroundColor: 'rgba(255,255,255,0.04)',
  borderRadius: '8px',
  marginBottom: '8px',
  fontSize: '13px',
};

const warningBoxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  padding: '10px 12px',
  backgroundColor: 'rgba(252,211,77,0.08)',
  border: `1px solid rgba(252,211,77,0.2)`,
  borderRadius: '8px',
  marginBottom: '8px',
  fontSize: '12px',
  color: tokens.warning,
  lineHeight: '1.4',
};

const addressBoxStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '10px 12px',
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: `1px solid ${tokens.border}`,
  borderRadius: '8px',
  marginBottom: '8px',
};

const addressTextStyle: CSSProperties = {
  flex: 1,
  fontFamily: 'monospace',
  fontSize: '12px',
  color: tokens.text,
  wordBreak: 'break-all',
};

const iconButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: tokens.textMuted,
  cursor: 'pointer',
  fontSize: '14px',
  padding: '4px',
  lineHeight: 1,
  transition: 'color 0.15s',
};

const actionButtonsRow: CSSProperties = {
  display: 'flex',
  gap: '6px',
  marginBottom: '8px',
  flexWrap: 'wrap',
};

const buttonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  padding: '6px 12px',
  borderRadius: '8px',
  border: `1px solid ${tokens.border}`,
  backgroundColor: tokens.bg,
  color: tokens.text,
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background-color 0.15s',
  whiteSpace: 'nowrap',
};

const primaryButton: CSSProperties = {
  ...buttonBase,
  backgroundColor: tokens.primary,
  borderColor: tokens.primary,
  color: '#fff',
};

const inputStyle: CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  borderRadius: '8px',
  border: `1px solid ${tokens.border}`,
  backgroundColor: 'rgba(255,255,255,0.04)',
  color: tokens.text,
  fontSize: '14px',
  fontFamily: 'monospace',
  outline: 'none',
};

const inputRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '8px',
};

const statusDotStyle = (isOnBase: boolean): CSSProperties => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: isOnBase ? tokens.success : tokens.warning,
  flexShrink: 0,
});

const feedbackStyle = (isError: boolean): CSSProperties => ({
  fontSize: '12px',
  color: isError ? tokens.error : tokens.success,
  marginBottom: '8px',
  padding: '6px 10px',
  borderRadius: '6px',
  backgroundColor: isError ? 'rgba(248,113,113,0.08)' : 'rgba(16,185,129,0.08)',
});

const balanceFooterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: '8px',
  borderTop: `1px solid ${tokens.border}`,
  fontSize: '13px',
};

const linkStyle: CSSProperties = {
  color: tokens.primaryLight,
  textDecoration: 'none',
  fontSize: '12px',
};

// ─── Helpers ────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function baseScanUrl(address: string, type: 'address' | 'token' = 'address'): string {
  return `https://basescan.org/${type}/${address}`;
}

// ─── Component ──────────────────────────────────────────────

/**
 * Deposit instructions panel with copy-to-clipboard, network switching,
 * and in-wallet USDC deposit. Inline CSSProperties, no external deps.
 */
export function DepositPanel({
  depositAddress,
  balanceDisplay,
  depositInstructions,
  isWalletOnBase,
  depositStatus = 'idle',
  depositError,
  depositResult,
  onSwitchToBase,
  onAddUsdcAsset,
  onDeposit,
  onAddressCopied,
  onRefreshBalance,
  onClose,
  className,
  recoveryPolicyUrl,
}: DepositPanelProps) {
  const [depositAmount, setDepositAmount] = useState('');
  const [copied, setCopied] = useState(false);

  const { network: instrNetwork, chainName, chainId: instrChainId, token: instrAsset, tokenAddress: instrContract, warning: instrWarning } = depositInstructions ?? {};
  const network = instrNetwork ?? chainName ?? 'Base';
  const chainId = instrChainId ?? 8453;
  const assetName = instrAsset ?? 'USDC';
  const contractAddr = instrContract;
  const warningText = instrWarning ?? `Send only ${assetName} on ${network}. Sending other tokens or using other networks may result in permanent loss.`;

  const isLoading = depositStatus === 'switching' || depositStatus === 'signing' || depositStatus === 'pending';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(depositAddress);
      setCopied(true);
      onAddressCopied?.();
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text approach not available in all environments
    }
  };

  const handleDeposit = () => {
    if (depositAmount && onDeposit) {
      onDeposit(depositAmount);
    }
  };

  const statusLabel: Record<DepositStatus, string> = {
    idle: '',
    switching: 'Switching network...',
    signing: 'Confirm in wallet...',
    pending: 'Transaction pending...',
    confirmed: 'Deposit confirmed!',
    error: 'Transaction failed',
  };

  return (
    <div style={panelStyle} className={className}>
      {/* ── Header ── */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={titleStyle}>Deposit Instructions</h3>
          <span style={badgeStyle}>
            {network} ({chainId})
          </span>
        </div>
        {onClose && (
          <button type="button" style={closeButtonStyle} onClick={onClose} aria-label="Close">
            {ICON_CLOSE}
          </button>
        )}
      </div>

      {/* ── Token / Contract info ── */}
      {contractAddr && (
        <div style={rowStyle}>
          <span style={{ color: tokens.textMuted }}>Token</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <strong style={{ color: '#f3f4f6' }}>{assetName}</strong>
            <a
              href={baseScanUrl(contractAddr, 'token')}
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
              title="View on BaseScan"
            >
              {truncateAddress(contractAddr)} {ICON_EXTERNAL}
            </a>
          </span>
        </div>
      )}

      {/* ── Warning box ── */}
      <div style={warningBoxStyle}>
        <span style={{ fontSize: '16px', flexShrink: 0 }}>{ICON_WARNING}</span>
        <div>
          <div>{warningText}</div>
          {recoveryPolicyUrl && (
            <a
              href={recoveryPolicyUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...linkStyle, marginTop: '4px', display: 'inline-block' }}
            >
              Recovery policy {ICON_EXTERNAL}
            </a>
          )}
        </div>
      </div>

      {/* ── Deposit address ── */}
      <div style={addressBoxStyle}>
        <span style={addressTextStyle}>{depositAddress}</span>
        <button type="button" style={iconButtonStyle} onClick={handleCopy} title="Copy address">
          {copied ? (
            <span style={{ color: tokens.success }}>{ICON_CHECK}</span>
          ) : (
            ICON_COPY
          )}
        </button>
        <a
          href={baseScanUrl(depositAddress)}
          target="_blank"
          rel="noopener noreferrer"
          style={iconButtonStyle}
          title="View on BaseScan"
        >
          {ICON_EXTERNAL}
        </a>
      </div>

      {/* ── Action buttons ── */}
      <div style={actionButtonsRow}>
        {onSwitchToBase && (
          <button type="button" style={buttonBase} onClick={onSwitchToBase} disabled={isLoading}>
            Switch to Base
          </button>
        )}
        {onAddUsdcAsset && (
          <button type="button" style={buttonBase} onClick={onAddUsdcAsset} disabled={isLoading}>
            Add {assetName} (Base)
          </button>
        )}
        {onDeposit && (
          <button
            type="button"
            style={primaryButton}
            onClick={handleDeposit}
            disabled={isLoading || !depositAmount}
          >
            {isLoading ? statusLabel[depositStatus] : 'Deposit From Wallet'}
          </button>
        )}
      </div>

      {/* ── Amount input + network status ── */}
      {onDeposit && (
        <div style={inputRowStyle}>
          <input
            type="text"
            inputMode="decimal"
            placeholder={`Amount in ${assetName}`}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            style={inputStyle}
            disabled={isLoading}
          />
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: tokens.textMuted }}
            title={isWalletOnBase ? 'Connected to Base' : 'Not on Base network'}
          >
            <div style={statusDotStyle(!!isWalletOnBase)} />
            <span>{isWalletOnBase ? 'Base' : 'Wrong network'}</span>
          </div>
        </div>
      )}

      {/* ── Status feedback ── */}
      {depositStatus !== 'idle' && statusLabel[depositStatus] && (
        <div style={feedbackStyle(depositStatus === 'error')}>
          {statusLabel[depositStatus]}
        </div>
      )}

      {/* ── Error feedback ── */}
      {depositError && (
        <div style={feedbackStyle(true)}>{depositError}</div>
      )}

      {/* ── Result feedback ── */}
      {depositResult && !depositError && (
        <div style={feedbackStyle(false)}>{depositResult}</div>
      )}

      {/* ── Balance footer ── */}
      {balanceDisplay && (
        <div style={balanceFooterStyle}>
          <span>
            Balance: <strong style={{ color: '#f3f4f6' }}>{balanceDisplay}</strong>
          </span>
          {onRefreshBalance && (
            <button type="button" style={{ ...iconButtonStyle, fontSize: '12px' }} onClick={onRefreshBalance}>
              Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
}
