/** Context describing the current wallet environment. */
export interface GeoWalletContext {
  /** User's connected wallet address (from auth/wagmi). */
  walletAddress?: string;
  /** Whether GEO_PRIVATE_KEY secret is available. */
  hasPrivateKey?: boolean;
  /** Explicit mode override. */
  forceMode?: 'PRIVATE_KEY' | 'APPROVAL';
}

/** Result of resolving the optimal wallet configuration. */
export interface GeoWalletConfigResult {
  /** Which mode to use. */
  mode: 'PRIVATE_KEY' | 'APPROVAL' | 'READ_ONLY';
  /** The configure_wallet tool args to pass (omitted for READ_ONLY). */
  configureWalletArgs?: {
    walletMode?: 'PRIVATE_KEY' | 'APPROVAL';
    walletAddress?: string;
  };
  /** Human-readable explanation. */
  reason: string;
}

/**
 * Determine the optimal wallet configuration for a Geo MCP server session.
 *
 * Decision logic:
 * 1. If forceMode is set, use it (requires walletAddress for APPROVAL mode).
 * 2. If hasPrivateKey is true, use PRIVATE_KEY (server auto-configures from env).
 * 3. If walletAddress is provided but no private key, use APPROVAL mode.
 * 4. Otherwise, READ_ONLY — no wallet configuration needed.
 */
export function resolveGeoWalletConfig(ctx: GeoWalletContext): GeoWalletConfigResult {
  // 1. Explicit override
  if (ctx.forceMode) {
    if (ctx.forceMode === 'APPROVAL') {
      return {
        mode: 'APPROVAL',
        configureWalletArgs: {
          walletMode: 'APPROVAL',
          walletAddress: ctx.walletAddress,
        },
        reason: 'Forced APPROVAL mode — transactions require wallet signature.',
      };
    }
    return {
      mode: 'PRIVATE_KEY',
      configureWalletArgs: { walletMode: 'PRIVATE_KEY' },
      reason: 'Forced PRIVATE_KEY mode — server signs transactions using env secret.',
    };
  }

  // 2. Private key available
  if (ctx.hasPrivateKey) {
    return {
      mode: 'PRIVATE_KEY',
      configureWalletArgs: { walletMode: 'PRIVATE_KEY' },
      reason: 'GEO_PRIVATE_KEY is available — server will sign transactions automatically.',
    };
  }

  // 3. Wallet address but no private key -> APPROVAL mode
  if (ctx.walletAddress) {
    return {
      mode: 'APPROVAL',
      configureWalletArgs: {
        walletMode: 'APPROVAL',
        walletAddress: ctx.walletAddress,
      },
      reason: 'Wallet connected but no private key — transactions will require approval signature.',
    };
  }

  // 4. Nothing available -> read-only
  return {
    mode: 'READ_ONLY',
    reason: 'No wallet configured — read-only tools available.',
  };
}
