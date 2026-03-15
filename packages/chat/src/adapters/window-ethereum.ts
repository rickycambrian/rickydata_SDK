import type { WalletAdapter } from '../types/wallet.js';

declare global {
  interface Window {
    ethereum?: {
      request(args: { method: string; params?: unknown[] }): Promise<unknown>;
      on?(event: string, handler: (...args: unknown[]) => void): void;
      removeListener?(event: string, handler: (...args: unknown[]) => void): void;
      selectedAddress?: string | null;
      isMetaMask?: boolean;
    };
  }
}

/** Create a WalletAdapter using window.ethereum (MetaMask / injected provider). */
export function createMetaMaskAdapter(): WalletAdapter {
  return {
    getAddress() {
      const addr = typeof window !== 'undefined' ? window.ethereum?.selectedAddress : null;
      return addr ? addr.toLowerCase() : null;
    },

    async signMessage(message: string): Promise<string> {
      const eth = window.ethereum;
      if (!eth) throw new Error('No ethereum provider found (window.ethereum)');

      const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
      const address = accounts[0];
      if (!address) throw new Error('No connected account');

      return (await eth.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
    },

    isReady() {
      return typeof window !== 'undefined' && !!window.ethereum;
    },

    onAddressChange(callback: (address: string | null) => void) {
      const eth = window.ethereum;
      if (!eth?.on || !eth.removeListener) return () => {};

      const handler = (accounts: unknown) => {
        const addrs = accounts as string[];
        callback(addrs[0]?.toLowerCase() ?? null);
      };
      eth.on('accountsChanged', handler);
      return () => eth.removeListener!('accountsChanged', handler);
    },
  };
}
