import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  AgentClient,
  type AgentClientConfig,
  type FreeTierStatus,
  type MarketplaceProvider,
  type ProviderVaultUnlockResult,
  type WalletBalanceResponse,
  type WalletSettings,
} from 'rickydata/agent';

export interface RickyDataWalletTransport {
  getWalletSettings?: () => Promise<WalletSettings>;
  updateWalletSettings?: (settings: Partial<WalletSettings>) => Promise<WalletSettings>;
  getWalletBalance?: () => Promise<WalletBalanceResponse>;
  getFreeTierStatus?: () => Promise<FreeTierStatus>;
  signMessage?: (message: string) => Promise<string>;
  unlockProviderVault?: (providers?: MarketplaceProvider[]) => Promise<ProviderVaultUnlockResult>;
}

interface RickyDataContextValue {
  client: AgentClient;
  walletTransport?: RickyDataWalletTransport;
}

const RickyDataContext = createContext<RickyDataContextValue | null>(null);

export interface RickyDataProviderProps {
  /** Config to auto-create an AgentClient. Provide `getAuthToken` for browser use. */
  config?: {
    gatewayUrl?: string;
    getAuthToken: () => Promise<string | undefined>;
    walletTransport?: RickyDataWalletTransport;
  };
  /** Pre-built client (for testing/mocks). Mutually exclusive with `config`. */
  client?: AgentClient;
  children: ReactNode;
}

/**
 * Provides an `AgentClient` instance to all descendant hooks and components.
 *
 * Usage:
 * ```tsx
 * <RickyDataProvider config={{ getAuthToken: () => getToken() }}>
 *   <App />
 * </RickyDataProvider>
 * ```
 */
export function RickyDataProvider({ config, client, children }: RickyDataProviderProps) {
  const contextValue = useMemo<RickyDataContextValue>(() => {
    if (client) return { client, walletTransport: config?.walletTransport };
    if (!config) throw new Error('RickyDataProvider requires either `config` or `client`');
    const opts: AgentClientConfig = {
      gatewayUrl: config.gatewayUrl,
    };
    // Wire the provider's getAuthToken callback to the SDK's tokenGetter
    opts.tokenGetter = config.getAuthToken;
    opts.signMessage = config.walletTransport?.signMessage;
    return {
      client: new AgentClient(opts),
      walletTransport: config.walletTransport,
    };
  }, [client, config?.getAuthToken, config?.gatewayUrl, config?.walletTransport]);

  return (
    <RickyDataContext.Provider value={contextValue}>
      {children}
    </RickyDataContext.Provider>
  );
}

/**
 * Access the AgentClient from context. Throws if used outside `<RickyDataProvider>`.
 */
export function useRickyData(): AgentClient {
  const ctx = useContext(RickyDataContext);
  if (!ctx) {
    throw new Error('useRickyData must be used within a <RickyDataProvider>');
  }
  return ctx.client;
}

export function useRickyDataWalletTransport(): RickyDataWalletTransport | undefined {
  const ctx = useContext(RickyDataContext);
  if (!ctx) {
    throw new Error('useRickyDataWalletTransport must be used within a <RickyDataProvider>');
  }
  return ctx.walletTransport;
}
