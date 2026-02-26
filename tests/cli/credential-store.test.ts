import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CredentialStore } from '../../src/cli/config/credential-store.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-creds-test-'));
}

describe('CredentialStore', () => {
  let tmpDir: string;
  let credsPath: string;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    credsPath = path.join(tmpDir, 'credentials.json');
    store = new CredentialStore(credsPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('initial state', () => {
    it('returns null for missing token', () => {
      expect(store.getToken()).toBeNull();
    });

    it('hasToken returns false initially', () => {
      expect(store.hasToken()).toBe(false);
    });
  });

  describe('setToken and getToken', () => {
    it('stores and retrieves a token for default profile', () => {
      store.setToken('mcpwt_abc123', '0x1234', 'default');
      const cred = store.getToken('default');
      expect(cred).not.toBeNull();
      expect(cred?.token).toBe('mcpwt_abc123');
      expect(cred?.walletAddress).toBe('0x1234');
    });

    it('stores token with expiry', () => {
      store.setToken('mcpwt_abc', '0x1234', 'default', '2027-01-01T00:00:00Z');
      const cred = store.getToken('default');
      expect(cred?.expiresAt).toBe('2027-01-01T00:00:00Z');
    });

    it('stores storedAt timestamp', () => {
      const before = new Date().toISOString();
      store.setToken('mcpwt_abc', '0x1234');
      const after = new Date().toISOString();
      const cred = store.getToken();
      expect(cred?.storedAt).toBeDefined();
      expect(cred!.storedAt >= before).toBe(true);
      expect(cred!.storedAt <= after).toBe(true);
    });

    it('persists tokens across instances', () => {
      store.setToken('mcpwt_persistent', '0xabcd');
      const store2 = new CredentialStore(credsPath);
      const cred = store2.getToken();
      expect(cred?.token).toBe('mcpwt_persistent');
    });

    it('stores tokens for different profiles independently', () => {
      store.setToken('mcpwt_prod', '0xprod', 'prod');
      store.setToken('mcpwt_staging', '0xstaging', 'staging');
      expect(store.getToken('prod')?.token).toBe('mcpwt_prod');
      expect(store.getToken('staging')?.token).toBe('mcpwt_staging');
    });
  });

  describe('hasToken', () => {
    it('returns true after storing a token', () => {
      store.setToken('mcpwt_test', '0x1');
      expect(store.hasToken()).toBe(true);
    });

    it('returns false for different profile', () => {
      store.setToken('mcpwt_test', '0x1', 'prod');
      expect(store.hasToken('staging')).toBe(false);
    });
  });

  describe('clear', () => {
    it('clears a specific profile', () => {
      store.setToken('mcpwt_abc', '0x1', 'prod');
      store.setToken('mcpwt_def', '0x2', 'staging');
      store.clear('prod');
      expect(store.getToken('prod')).toBeNull();
      expect(store.getToken('staging')?.token).toBe('mcpwt_def');
    });

    it('clearAll removes all tokens', () => {
      store.setToken('mcpwt_abc', '0x1', 'prod');
      store.setToken('mcpwt_def', '0x2', 'staging');
      store.clearAll();
      expect(store.getToken('prod')).toBeNull();
      expect(store.getToken('staging')).toBeNull();
    });
  });

  describe('file permissions', () => {
    it('creates credentials file with 0600 permissions', () => {
      store.setToken('mcpwt_secure', '0xsecure');
      const stat = fs.statSync(credsPath);
      // Check that file is not group/world readable (mode & 0o077 should be 0)
      expect(stat.mode & 0o077).toBe(0);
    });
  });

  describe('corrupted credentials file', () => {
    it('falls back to empty state on parse error', () => {
      fs.writeFileSync(credsPath, 'INVALID JSON');
      const store2 = new CredentialStore(credsPath);
      expect(store2.getToken()).toBeNull();
    });
  });
});
