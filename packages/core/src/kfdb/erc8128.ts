import { privateKeyToAccount } from 'viem/accounts';

/**
 * ERC-8128 HTTP Message Signatures (RFC 9421 + EIP-191 wallet signing).
 *
 * KFDB accepts these as priority-1, token-free authentication: the wallet IS
 * the credential, and an unknown wallet is auto-provisioned its own tenant on
 * first request. Use these headers on any KFDB request when no API key is
 * available.
 *
 * Wire contract (must stay byte-compatible with the server's
 * `kfdb-api/src/auth/erc8128.rs` — pinned in
 * `docs/contracts/cross-language-auth-kfdb.yaml`):
 *   - Covered components: `@method @path @authority` ONLY. KFDB verifies at the
 *     middleware layer with an empty body slice, so a `content-digest` header
 *     would FAIL verification — never send one.
 *   - Signature base lines: `"component": value\n` per component, then
 *     `"@signature-params": (...)` with NO trailing newline.
 *   - EIP-191 personal_sign over the base bytes; 65-byte r||s||v (v = 27/28),
 *     base64 (standard alphabet) in `Signature: eth=:...:`.
 *   - keyid `erc8128:{chainId}:{address}`; validity window ≤ 120s server-side.
 *   - Nonce is single-use per keyid (server replay guard) — sign fresh headers
 *     for EVERY request, never reuse a pair.
 */

export const ERC8128_LABEL = 'eth';
/** Base mainnet — the only network this platform uses. */
export const ERC8128_CHAIN_ID = 8453;
/** Keep well under the server's 120s max validity (plus 15s skew allowance). */
const VALIDITY_SEC = 90;
const CREATED_BACKDATE_SEC = 5;

export interface Erc8128SignInput {
  method: string;
  /** Absolute request URL; @path and @authority are derived from it. */
  url: string;
  privateKey: string;
  chainId?: number;
  /** Test seams — omit in production use. */
  createdSec?: number;
  nonce?: string;
}

export interface Erc8128Headers {
  'Signature-Input': string;
  Signature: string;
}

/** Build the RFC 9421 signature base string (exported for tests). */
export function buildErc8128SignatureBase(input: {
  method: string;
  path: string;
  authority: string;
  created: number;
  expires: number;
  nonce: string;
  keyid: string;
}): string {
  const params = `(@method @path @authority;created=${input.created};expires=${input.expires};nonce="${input.nonce}";keyid="${input.keyid}")`;
  return (
    `"@method": ${input.method.toUpperCase()}\n` +
    `"@path": ${input.path}\n` +
    `"@authority": ${input.authority}\n` +
    `"@signature-params": ${params}`
  );
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign one HTTP request. Returns the two headers to attach. Each call uses a
 * fresh single-use nonce — callers must sign per request, not per session.
 */
export async function signErc8128Request(input: Erc8128SignInput): Promise<Erc8128Headers> {
  const parsed = new URL(input.url);
  // URL.host matches what fetch sends as the Host header (port included only
  // when non-default), which is what the server reads back as @authority.
  const authority = parsed.host;
  const path = parsed.pathname;
  const created = input.createdSec ?? Math.floor(Date.now() / 1000) - CREATED_BACKDATE_SEC;
  const expires = created + VALIDITY_SEC;
  const nonce = input.nonce ?? randomNonce();
  const chainId = input.chainId ?? ERC8128_CHAIN_ID;

  const normalizedKey = (
    input.privateKey.startsWith('0x') ? input.privateKey : `0x${input.privateKey}`
  ) as `0x${string}`;
  const account = privateKeyToAccount(normalizedKey);
  const keyid = `erc8128:${chainId}:${account.address}`;

  const base = buildErc8128SignatureBase({
    method: input.method,
    path,
    authority,
    created,
    expires,
    nonce,
    keyid,
  });
  // viem applies the EIP-191 personal_sign prefix and returns r||s||v hex (v = 27/28).
  const signature = await account.signMessage({ message: base });
  const sigB64 = Buffer.from(signature.slice(2), 'hex').toString('base64');

  return {
    'Signature-Input': `${ERC8128_LABEL}=(@method @path @authority;created=${created};expires=${expires};nonce="${nonce}";keyid="${keyid}")`,
    Signature: `${ERC8128_LABEL}=:${sigB64}:`,
  };
}
