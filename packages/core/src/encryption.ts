/**
 * Encryption Utilities
 *
 * Provides cryptographic utilities for sign-to-derive key derivation.
 * Uses viem's keccak256 for Ethereum-compatible hashing.
 */

import { keccak256, toHex, hexToBytes } from 'viem';

/**
 * Derives an encryption key from an Ethereum signature.
 *
 * This enables true user-controlled encryption:
 * - User signs a message with their wallet
 * - Signature is used to derive the encryption key
 * - Only the user can encrypt/decrypt (operator cannot read)
 *
 * Uses keccak256 hash of the signature to derive a 32-byte key.
 *
 * @param signature - Ethereum signature (65 bytes: r, s, v)
 * @returns Hex string of the derived key (32 bytes)
 */
export function deriveKeyFromSignature(signature: string): string {
  // Normalize signature (remove 0x prefix if present)
  const normalizedSig = signature.startsWith('0x') ? signature.slice(2) : signature;

  // Ensure signature is valid length (65 bytes = 130 hex chars)
  if (normalizedSig.length !== 130) {
    throw new Error('Invalid signature length: expected 65 bytes (130 hex chars)');
  }

  // Parse signature components
  const r = normalizedSig.slice(0, 64);
  const s = normalizedSig.slice(64, 128);
  const v = normalizedSig.slice(128, 130);

  // Combine r, s, v and hash with keccak256
  const signatureBytes = new Uint8Array([
    ...hexToBytes(`0x${r}`),
    ...hexToBytes(`0x${s}`),
    ...hexToBytes(`0x${v}`),
  ]);
  const derivedKey = keccak256(signatureBytes);

  return derivedKey;
}

/**
 * Generates a nonce message for sign-to-derive encryption.
 *
 * The server should send this message to the client to sign.
 * The resulting signature is used to derive the encryption key.
 *
 * @param walletAddress - User's wallet address
 * @returns Message to sign
 */
export function getDeriveKeyMessage(walletAddress: string): string {
  const nonce = generateNonce();
  return `Derive encryption key for ${walletAddress} with nonce ${nonce}`;
}

/**
 * Generates a random nonce for key derivation.
 */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
