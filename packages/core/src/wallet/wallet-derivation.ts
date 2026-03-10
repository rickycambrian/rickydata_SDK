import { HD_PATH_PREFIX } from '../constants.js';

/**
 * Derive a spending wallet account from a BIP-39 seed phrase.
 * Uses path: m/44'/60'/8453'/0/{index}
 * where 8453 = Base mainnet chain ID.
 */
export async function deriveSpendingAccount(seedPhrase: string, index: number = 0) {
  const { mnemonicToAccount } = await import('viem/accounts');
  const path = `${HD_PATH_PREFIX}/${index}` as const;
  return mnemonicToAccount(seedPhrase, { path });
}

/** Create a viem account from a raw private key */
export async function accountFromPrivateKey(privateKey: string) {
  const { privateKeyToAccount } = await import('viem/accounts');
  return privateKeyToAccount(privateKey as `0x${string}`);
}

/** Generate a random private key and account (for dev/testing only) */
export async function generateAccount() {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  return { privateKey: key, account };
}
