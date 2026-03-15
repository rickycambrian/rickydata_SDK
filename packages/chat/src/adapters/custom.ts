import type { WalletAdapter } from '../types/wallet.js';

export interface CustomAdapterOptions {
  getAddress: () => string | null;
  signMessage: (message: string) => Promise<string>;
  isReady?: () => boolean;
  onAddressChange?: (callback: (address: string | null) => void) => () => void;
}

/** Create a WalletAdapter from custom functions. */
export function createCustomAdapter(opts: CustomAdapterOptions): WalletAdapter {
  return {
    getAddress: opts.getAddress,
    signMessage: opts.signMessage,
    isReady: opts.isReady ?? (() => opts.getAddress() !== null),
    onAddressChange: opts.onAddressChange,
  };
}
