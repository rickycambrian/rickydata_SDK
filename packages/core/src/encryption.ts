/**
 * Encryption Utilities
 *
 * Provides cryptographic utilities for sign-to-derive key derivation
 * and AES-256-GCM client-side encryption/decryption.
 *
 * Uses SHA-256 for key derivation (matching the Go/SiYuan client).
 * All encryption/decryption happens client-side via WebCrypto —
 * the server never sees plaintext property values.
 */

import { sha256, keccak256, hexToBytes } from 'viem';

// ── Constants ────────────────────────────────────────────────────────────

const CENC_PREFIX = "__cenc_v1_";
const NONCE_BYTES = 12;

// ── Type Tags (must match Rust-side deserialization) ─────────────────────

type TypeTag = "str" | "int" | "float" | "bool" | "null" | "arr" | "obj";

// ── Key Derivation ───────────────────────────────────────────────────────

/**
 * Returns a deterministic message for sign-to-derive key derivation.
 *
 * The wallet address parameter is kept for backward compatibility but
 * the message MUST be deterministic — the same signature always produces
 * the same encryption key.
 *
 * @param _walletAddress - User's wallet address (kept for compat, unused)
 * @returns Fixed message to sign
 */
export function getDeriveKeyMessage(_walletAddress: string): string {
  return "KFDB Encryption Key\nVersion: 1\nChain: 8453";
}

/**
 * Derives an encryption key from an Ethereum signature using SHA-256.
 *
 * This enables true user-controlled encryption:
 * - User signs a deterministic message with their wallet
 * - Signature is used to derive the encryption key
 * - Only the user can encrypt/decrypt (operator cannot read)
 *
 * Uses SHA-256 hash of the signature to derive a 32-byte key.
 * This matches the Go client (SiYuan) for cross-client interop.
 *
 * @param signature - Ethereum signature (65 bytes: r, s, v)
 * @returns Hex string of the derived key (32 bytes)
 */
export function deriveKeyFromSignature(signature: string): string {
  return deriveKeyFromSignatureBytes(signature, sha256);
}

/**
 * Legacy key derivation using keccak256.
 *
 * Use this only to decrypt data encrypted with keys derived before
 * the SHA-256 migration. New code should use deriveKeyFromSignature().
 *
 * @param signature - Ethereum signature (65 bytes: r, s, v)
 * @returns Hex string of the derived key (32 bytes)
 */
export function deriveKeyFromSignatureLegacy(signature: string): string {
  return deriveKeyFromSignatureBytes(signature, keccak256);
}

/** Shared implementation for key derivation with pluggable hash function. */
function deriveKeyFromSignatureBytes(
  signature: string,
  hashFn: (bytes: Uint8Array) => string,
): string {
  const normalizedSig = signature.startsWith('0x') ? signature.slice(2) : signature;

  if (normalizedSig.length !== 130) {
    throw new Error('Invalid signature length: expected 65 bytes (130 hex chars)');
  }

  const r = normalizedSig.slice(0, 64);
  const s = normalizedSig.slice(64, 128);
  const v = normalizedSig.slice(128, 130);

  const rBytes = hexToBytes(`0x${r}`);
  const sBytes = hexToBytes(`0x${s}`);
  const vBytes = hexToBytes(`0x${v}`);
  const signatureBytes = new Uint8Array(rBytes.length + sBytes.length + vBytes.length);
  signatureBytes.set(rBytes, 0);
  signatureBytes.set(sBytes, rBytes.length);
  signatureBytes.set(vBytes, rBytes.length + sBytes.length);

  return hashFn(signatureBytes);
}

/**
 * Imports a derived key hex string as a WebCrypto CryptoKey for AES-256-GCM.
 *
 * @param hexKey - 32-byte hex key from deriveKeyFromSignature (with or without 0x prefix)
 * @returns CryptoKey suitable for encryptValue/decryptValue
 */
export async function importKeyFromHex(hexKey: string): Promise<CryptoKey> {
  const hex = hexKey.startsWith('0x') ? hexKey.slice(2) : hexKey;
  if (hex.length !== 64) {
    throw new Error('Invalid key length: expected 32 bytes (64 hex chars)');
  }
  const keyBytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Type Classification & Serialization ──────────────────────────────────

function classifyValue(value: unknown): TypeTag {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return "str";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "int" : "float";
  }
  if (typeof value === "boolean") return "bool";
  if (Array.isArray(value)) return "arr";
  return "obj";
}

function serializeValue(tag: TypeTag, value: unknown): Uint8Array {
  switch (tag) {
    case "str":
      return new TextEncoder().encode(value as string);
    case "int": {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setBigInt64(0, BigInt(value as number), true);
      return new Uint8Array(buf);
    }
    case "float": {
      const buf = new ArrayBuffer(8);
      new DataView(buf).setFloat64(0, value as number, true);
      return new Uint8Array(buf);
    }
    case "bool":
      return new Uint8Array([(value as boolean) ? 1 : 0]);
    case "null":
      return new Uint8Array(0);
    case "arr":
    case "obj":
      return new TextEncoder().encode(JSON.stringify(value));
  }
}

function deserializeValue(tag: TypeTag, bytes: Uint8Array): unknown {
  switch (tag) {
    case "str":
      return new TextDecoder().decode(bytes);
    case "int":
      return Number(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(0, true));
    case "float":
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
    case "bool":
      return bytes[0] === 1;
    case "null":
      return null;
    case "arr":
    case "obj":
      return JSON.parse(new TextDecoder().decode(bytes));
  }
}

// ── Base64 Helpers ───────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Encrypt / Decrypt ────────────────────────────────────────────────────

/**
 * Encrypt a single value with AES-256-GCM.
 * Returns wire format: "__cenc_v1_{type}:{base64(nonce || ciphertext || tag)}"
 */
export async function encryptValue(key: CryptoKey, value: unknown): Promise<string> {
  const tag = classifyValue(value);
  const plaintext = serializeValue(tag, value);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new Uint8Array(plaintext) as unknown as ArrayBuffer,
  );

  // Concat nonce + ciphertext (WebCrypto appends 16-byte auth tag to ciphertext)
  const combined = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(ciphertext), NONCE_BYTES);

  return `${CENC_PREFIX}${tag}:${toBase64(combined)}`;
}

/**
 * Decrypt a __cenc_v1_ encoded string back to its original value.
 */
export async function decryptValue(key: CryptoKey, encoded: string): Promise<unknown> {
  if (!encoded.startsWith(CENC_PREFIX)) {
    throw new Error("Not a client-encrypted value");
  }

  const rest = encoded.slice(CENC_PREFIX.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) {
    throw new Error("Invalid cenc format: missing type tag");
  }

  const tag = rest.slice(0, colonIdx) as TypeTag;
  const b64 = rest.slice(colonIdx + 1);
  const combined = fromBase64(b64);

  if (combined.length < NONCE_BYTES) {
    throw new Error("Invalid cenc format: data too short");
  }

  const nonce = combined.slice(0, NONCE_BYTES);
  const ciphertextWithTag = combined.slice(NONCE_BYTES);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    ciphertextWithTag,
  );

  return deserializeValue(tag, new Uint8Array(plaintext));
}

// ── KFDB Property Helpers ────────────────────────────────────────────────

/**
 * Extract the raw value from a KFDB typed property wrapper.
 * e.g. {"String": "hello"} -> "hello", {"Integer": 42} -> 42
 */
function extractTypedValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const obj = v as Record<string, unknown>;
    if ("String" in obj) return obj.String;
    if ("Integer" in obj) return obj.Integer;
    if ("Float" in obj) return obj.Float;
    if ("Boolean" in obj) return obj.Boolean;
  }
  return v;
}

/**
 * Encrypt all property values in a properties object.
 * Each value is encrypted and wrapped in a KFDB String type wrapper,
 * since all ciphertext is stored as strings.
 */
export async function encryptProperties(
  key: CryptoKey,
  props: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    const raw = extractTypedValue(v);
    const encrypted = await encryptValue(key, raw);
    result[k] = { String: encrypted };
  }
  return result;
}

/**
 * Decrypt all __cenc_v1_ values found in query response rows.
 * Non-encrypted values pass through unchanged.
 */
export async function decryptResponseRows(
  key: CryptoKey,
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const decrypted: Record<string, unknown>[] = [];

  for (const row of rows) {
    const newRow: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const raw = extractTypedValue(v);
      if (typeof raw === "string" && raw.startsWith(CENC_PREFIX)) {
        newRow[k] = await decryptValue(key, raw);
      } else {
        newRow[k] = v;
      }
    }
    decrypted.push(newRow);
  }

  return decrypted;
}

/** Check if a string is client-encrypted */
export function isClientEncrypted(value: string): boolean {
  return value.startsWith(CENC_PREFIX);
}
