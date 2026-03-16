/**
 * Shared Privy configuration factory.
 *
 * All rickydata apps use the same core Privy settings (chains, login methods,
 * embedded wallets, wallet list). Only the appearance (logo, header text) differs
 * per app — those are passed in via `overrides`.
 *
 * NOTE: This module intentionally avoids importing from `@privy-io/react-auth`
 * or `wagmi/chains` so the auth package stays dependency-free.
 * Consumers cast the return value to `PrivyClientConfig` in their own code.
 */

export interface PrivyAppearanceOverrides {
  /** App logo path (e.g. '/favicon.svg') */
  logo?: string;
  /** Landing page header text */
  landingHeader?: string;
  /** Login prompt message */
  loginMessage?: string;
  /** Accent color hex string (e.g. '#007AFF') */
  accentColor?: string;
}

export interface PrivyConfigOptions {
  /** Chain objects — pass `base` and `baseSepolia` from wagmi/chains */
  defaultChain: unknown;
  supportedChains: unknown[];
  /** App-specific appearance overrides */
  appearance?: PrivyAppearanceOverrides;
}

/**
 * Create a Privy client configuration with shared defaults.
 *
 * Usage:
 * ```ts
 * import { base, baseSepolia } from 'wagmi/chains';
 * import type { PrivyClientConfig } from '@privy-io/react-auth';
 *
 * const config = createPrivyConfig({
 *   defaultChain: base,
 *   supportedChains: [base, baseSepolia],
 *   appearance: {
 *     logo: '/favicon.svg',
 *     landingHeader: 'Sign in to MyApp',
 *     loginMessage: 'Welcome to MyApp',
 *   },
 * }) as PrivyClientConfig;
 * ```
 */
export function createPrivyConfig(options: PrivyConfigOptions): Record<string, unknown> {
  const { defaultChain, supportedChains, appearance } = options;

  return {
    defaultChain,
    supportedChains,
    embeddedWallets: {
      ethereum: {
        createOnLogin: 'users-without-wallets',
      },
    },
    loginMethodsAndOrder: {
      primary: ['google', 'email', 'github'],
      overflow: ['discord', 'metamask', 'coinbase_wallet', 'wallet_connect'],
    },
    appearance: {
      theme: 'dark',
      accentColor: appearance?.accentColor ?? '#007AFF',
      logo: appearance?.logo ?? '/favicon.svg',
      landingHeader: appearance?.landingHeader ?? 'Sign in',
      loginMessage: appearance?.loginMessage ?? 'Connect your wallet or sign in to continue',
      showWalletLoginFirst: false,
      walletList: [
        'metamask',
        'coinbase_wallet',
        'wallet_connect',
        'detected_ethereum_wallets',
      ],
    },
  };
}
