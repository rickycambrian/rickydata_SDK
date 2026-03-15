import type { WalletAdapter } from '../types/wallet.js';

/**
 * Privy wallet/auth types (inlined to avoid hard dep on @privy-io/react-auth).
 * Consumers pass the return values of useWallets() and useAuth() from Privy.
 */
interface PrivyWallet {
  address: string;
  getEthereumProvider(): Promise<{
    request(args: { method: string; params: unknown[] }): Promise<unknown>;
  }>;
}

interface PrivyWallets {
  wallets: PrivyWallet[];
  ready: boolean;
}

interface PrivyAuth {
  user: { wallet?: { address: string } } | null;
}

function normalize(addr: string | null | undefined): string | null {
  return addr ? addr.toLowerCase() : null;
}

/**
 * Create a WalletAdapter wrapping Privy's hook returns.
 *
 * Usage:
 * ```ts
 * const { wallets, ready } = useWallets();
 * const privyAuth = useAuth();
 * const adapter = createPrivyAdapter({ wallets, ready }, privyAuth);
 * ```
 */
export function createPrivyAdapter(wallets: PrivyWallets, privyAuth: PrivyAuth): WalletAdapter {
  return {
    getAddress() {
      const addr = privyAuth.user?.wallet?.address ?? wallets.wallets[0]?.address ?? null;
      return normalize(addr);
    },

    async signMessage(message: string): Promise<string> {
      const address = this.getAddress();
      if (!address) throw new Error('No Privy wallet connected');

      const wallet =
        wallets.wallets.find((w) => normalize(w.address) === address) ?? wallets.wallets[0];
      if (!wallet) throw new Error('No Privy wallet available');

      const provider = await wallet.getEthereumProvider();
      return (await provider.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
    },

    isReady() {
      return wallets.ready && wallets.wallets.length > 0;
    },
  };
}
