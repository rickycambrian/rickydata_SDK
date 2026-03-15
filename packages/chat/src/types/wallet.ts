/**
 * Wallet adapter interface — plain object, not a hook.
 * Created outside React, passed to ChatBubbleProvider.
 * This decouples the chat bubble from any specific wallet library.
 */
export interface WalletAdapter {
  /** Return the connected wallet address (lowercase 0x-prefixed) or null. */
  getAddress(): string | null;

  /** EIP-191 personal_sign. Used for gateway challenge/verify auth. */
  signMessage(message: string): Promise<string>;

  /** Whether the wallet is ready to sign (connected + initialized). */
  isReady(): boolean;

  /** Subscribe to address changes. Returns unsubscribe function. */
  onAddressChange?(callback: (address: string | null) => void): () => void;
}
