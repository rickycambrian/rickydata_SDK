import { describe, it, expect } from 'vitest';
import { recoverMessageAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ERC8128_CHAIN_ID,
  buildErc8128SignatureBase,
  signErc8128Request,
} from '../src/kfdb/erc8128.js';

// Throwaway test-only key (the first valid secp256k1 scalar), never a real wallet.
const TEST_KEY = `0x${'0'.repeat(63)}1` as const;
const TEST_ADDR = privateKeyToAccount(TEST_KEY).address;

/**
 * Mirror of the KFDB server verification (kfdb-api/src/auth/erc8128.rs):
 * parse Signature-Input / Signature, rebuild the signature base from the
 * request, EIP-191-recover, and return the signer address.
 */
async function serverVerify(
  method: string,
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const sigInput = headers['Signature-Input'];
  const m = /^([^=]+)=\((.+)\)$/.exec(sigInput);
  if (!m) throw new Error('bad Signature-Input');
  const inner = m[2];
  const semi = inner.indexOf(';');
  const components = inner.slice(0, semi).split(/\s+/);
  const params: Record<string, string> = {};
  for (const kv of inner.slice(semi + 1).split(';')) {
    const [k, v] = kv.split('=');
    params[k] = v.replace(/^"|"$/g, '');
  }

  const parsed = new URL(url);
  let base = '';
  for (const c of components) {
    let value: string;
    if (c === '@method') value = method.toUpperCase();
    else if (c === '@path') value = parsed.pathname;
    else if (c === '@authority') value = parsed.host;
    else throw new Error(`unsupported component ${c}`);
    base += `"${c}": ${value}\n`;
  }
  base += `"@signature-params": (${components.join(' ')};created=${params.created};expires=${params.expires};nonce="${params.nonce}";keyid="${params.keyid}")`;

  const sm = new RegExp(`^${m[1]}=:(.+):$`).exec(headers.Signature);
  if (!sm) throw new Error('bad Signature header');
  const sigBytes = Buffer.from(sm[1], 'base64');
  if (sigBytes.length !== 65) throw new Error(`signature must be 65 bytes, got ${sigBytes.length}`);

  const recovered = await recoverMessageAddress({
    message: base,
    signature: `0x${sigBytes.toString('hex')}` as `0x${string}`,
  });

  const keyAddr = params.keyid.split(':')[2];
  if (recovered.toLowerCase() !== keyAddr.toLowerCase()) throw new Error('address mismatch');
  return recovered;
}

describe('ERC-8128 request signing (SDK)', () => {
  it('round-trips through a mirror of the KFDB server verifier', async () => {
    const url = 'http://34.60.37.158/api/v1/write';
    const headers = await signErc8128Request({ method: 'POST', url, privateKey: TEST_KEY });
    const recovered = await serverVerify('POST', url, headers as unknown as Record<string, string>);
    expect(recovered.toLowerCase()).toBe(TEST_ADDR.toLowerCase());
  });

  it('binds the signature to method and path', async () => {
    const url = 'http://34.60.37.158/api/v1/write';
    const headers = (await signErc8128Request({
      method: 'POST',
      url,
      privateKey: TEST_KEY,
    })) as unknown as Record<string, string>;
    await expect(serverVerify('PUT', url, headers)).rejects.toThrow('address mismatch');
    await expect(serverVerify('POST', 'http://34.60.37.158/api/v1/kv', headers)).rejects.toThrow(
      'address mismatch',
    );
  });

  it('emits the exact wire format the server parser expects', async () => {
    const headers = await signErc8128Request({
      method: 'post',
      url: 'http://34.60.37.158/api/v1/kv?x=1',
      privateKey: TEST_KEY,
      createdSec: 1710000000,
      nonce: 'abc123',
    });
    expect(headers['Signature-Input']).toBe(
      `eth=(@method @path @authority;created=1710000000;expires=1710000090;nonce="abc123";keyid="erc8128:${ERC8128_CHAIN_ID}:${TEST_ADDR}")`,
    );
    expect(headers.Signature).toMatch(/^eth=:[A-Za-z0-9+/]+=*:$/);
    // Query string is NOT covered (only @method @path @authority) and the path excludes it.
    expect(headers['Signature-Input']).not.toContain('@query');
    expect(headers['Signature-Input']).not.toContain('content-digest');
  });

  it('uses a fresh nonce per call (server nonces are single-use)', async () => {
    const url = 'http://34.60.37.158/api/v1/write';
    const a = await signErc8128Request({ method: 'POST', url, privateKey: TEST_KEY });
    const b = await signErc8128Request({ method: 'POST', url, privateKey: TEST_KEY });
    expect(a['Signature-Input']).not.toBe(b['Signature-Input']);
  });

  it('signature base matches the documented server format', () => {
    const base = buildErc8128SignatureBase({
      method: 'POST',
      path: '/api/v1/query',
      authority: '34.60.37.158',
      created: 1710000000,
      expires: 1710000120,
      nonce: 'test123',
      keyid: 'erc8128:1:0x1234567890123456789012345678901234567890',
    });
    expect(base).toContain('"@method": POST\n');
    expect(base).toContain('"@path": /api/v1/query\n');
    expect(base).toContain('"@authority": 34.60.37.158\n');
    expect(base).toContain('"@signature-params": (@method @path @authority;created=1710000000;');
    expect(base.endsWith(')')).toBe(true); // no trailing newline after @signature-params
  });

  it('accepts a private key without 0x prefix', async () => {
    const url = 'http://34.60.37.158/api/v1/write';
    const headers = await signErc8128Request({
      method: 'POST',
      url,
      privateKey: TEST_KEY.slice(2),
    });
    const recovered = await serverVerify('POST', url, headers as unknown as Record<string, string>);
    expect(recovered.toLowerCase()).toBe(TEST_ADDR.toLowerCase());
  });
});
