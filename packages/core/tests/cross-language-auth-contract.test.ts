import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CONTRACT_PATH = new URL('../../../docs/contracts/cross-language-auth-kfdb.yaml', import.meta.url);
const PACKAGE_CONTRACT_PATH = new URL('../contracts/cross-language-auth-kfdb.yaml', import.meta.url);
const AUTH_SOURCE_PATH = new URL('../src/auth.ts', import.meta.url);
const KFDB_TYPES_PATH = new URL('../src/kfdb/types.ts', import.meta.url);
const KFDB_CLIENT_PATH = new URL('../src/kfdb/client.ts', import.meta.url);

describe('cross-language auth contract artifact', () => {
  it('documents the wallet-token endpoints and canonical mcpwt payload fields', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf-8');
    const authSource = readFileSync(AUTH_SOURCE_PATH, 'utf-8');

    expect(contract).toContain('/api/auth/token-message:');
    expect(contract).toContain('/api/auth/create-token:');
    expect(contract).toContain('walletAddress');
    expect(contract).toContain('expiresAt');
    expect(contract).toContain('permissions');
    expect(contract).toContain('serverId');

    expect(contract).toContain('Canonical wallet address field.');
    expect(contract).toContain('sub:');
    expect(contract).toContain('iss:');
    expect(contract).toContain('exp:');
    expect(contract).toContain('iat:');
    expect(contract).toContain('server_id:');
    expect(contract).toContain('legacy decode compatibility');

    expect(authSource).toContain('sub: string;');
    expect(authSource).toContain('server_id?: string;');
  });

  it('documents the KFDB derive flow, headers, and cache shape used by current client code', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf-8');
    const kfdbTypes = readFileSync(KFDB_TYPES_PATH, 'utf-8');
    const kfdbClient = readFileSync(KFDB_CLIENT_PATH, 'utf-8');

    expect(contract).toContain('/api/v1/auth/derive-challenge:');
    expect(contract).toContain('/api/v1/auth/derive-key:');
    expect(contract).toContain('challenge_id');
    expect(contract).toContain('typed_data');
    expect(contract).toContain('session_id');
    expect(contract).toContain('expires_at');
    expect(contract).toContain('SHA-256(signature bytes)');
    expect(contract).toContain('X-Derive-Session-Id');
    expect(contract).toContain('X-Derive-Key');
    expect(contract).toContain('X-Wallet-Address');
    expect(contract).toContain('sessionId');
    expect(contract).toContain('keyHex');
    expect(contract).toContain('expiresAt');
    expect(contract).toContain('address');
    expect(contract).toContain('refresh when within 60 seconds');

    expect(kfdbTypes).toContain('challenge_id: string;');
    expect(kfdbTypes).toContain('session_id: string;');
    expect(kfdbClient).toContain("headers.set('X-Wallet-Address', this.walletAddress);");
    expect(kfdbClient).toContain("headers.set('X-Derive-Session-Id', this.deriveSessionId);");
    expect(kfdbClient).toContain("headers.set('X-Derive-Key', this.deriveKeyHex);");
  });

  it('explicitly keeps browser login and JS storage out of the cross-language contract', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf-8');

    expect(contract).toContain('Browser login is out-of-band');
    expect(contract).toContain('Do not require cross-language clients to read JS credential files or browser storage.');
  });

  it('keeps the published package contract identical to the repo-level contract', () => {
    const repoContract = readFileSync(CONTRACT_PATH, 'utf-8');
    const packageContract = readFileSync(PACKAGE_CONTRACT_PATH, 'utf-8');

    expect(packageContract).toBe(repoContract);
  });
});
