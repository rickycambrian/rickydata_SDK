import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { AgentClient, type AgentClientConfig } from 'rickydata/agent';

const RickyDataContext = createContext<AgentClient | null>(null);

export interface RickyDataProviderProps {
  /** Config to auto-create an AgentClient. Provide `getAuthToken` for browser use. */
  config?: {
    gatewayUrl?: string;
    getAuthToken: () => Promise<string | undefined>;
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
  const agentClient = useMemo(() => {
    if (client) return client;
    if (!config) throw new Error('RickyDataProvider requires either `config` or `client`');
    const opts: AgentClientConfig = {
      gatewayUrl: config.gatewayUrl,
    };
    // Wire the provider's getAuthToken callback to the SDK's tokenGetter
    opts.tokenGetter = config.getAuthToken;
    return new AgentClient(opts);
  }, [client, config?.getAuthToken, config?.gatewayUrl]);

  return (
    <RickyDataContext.Provider value={agentClient}>
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
  return ctx;
}
