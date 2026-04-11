import { describe, it, expect } from 'vitest';
import {
  deriveKeyFromSignature,
  deriveKeyFromSignatureLegacy,
  getDeriveKeyMessage,
  importKeyFromHex,
  encryptValue,
  decryptValue,
  encryptProperties,
  decryptResponseRows,
  isClientEncrypted,
} from '../src/encryption.js';

// A valid 65-byte signature (130 hex chars) for testing key derivation
const TEST_SIG = '0x' + 'ab'.repeat(32) + 'cd'.repeat(32) + '1b';

describe('getDeriveKeyMessage', () => {
  it('returns a deterministic message regardless of wallet address', () => {
    const msg1 = getDeriveKeyMessage('0xAAA');
    const msg2 = getDeriveKeyMessage('0xBBB');
    expect(msg1).toBe(msg2);
    expect(msg1).toBe("KFDB Encryption Key\nVersion: 1\nChain: 8453");
  });

  it('returns the same message on repeated calls', () => {
    const msg1 = getDeriveKeyMessage('0x1234');
    const msg2 = getDeriveKeyMessage('0x1234');
    expect(msg1).toBe(msg2);
  });
});

describe('deriveKeyFromSignature', () => {
  it('produces a deterministic 32-byte hex key using SHA-256', () => {
    const key1 = deriveKeyFromSignature(TEST_SIG);
    const key2 = deriveKeyFromSignature(TEST_SIG);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('produces a different key than legacy keccak256 derivation', () => {
    const sha256Key = deriveKeyFromSignature(TEST_SIG);
    const keccakKey = deriveKeyFromSignatureLegacy(TEST_SIG);
    expect(sha256Key).not.toBe(keccakKey);
    // Both should be valid 32-byte hex keys
    expect(keccakKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('accepts signatures without 0x prefix', () => {
    const withPrefix = deriveKeyFromSignature(TEST_SIG);
    const withoutPrefix = deriveKeyFromSignature(TEST_SIG.slice(2));
    expect(withPrefix).toBe(withoutPrefix);
  });

  it('rejects invalid signature length', () => {
    expect(() => deriveKeyFromSignature('0xabcd')).toThrow('Invalid signature length');
  });
});

describe('deriveKeyFromSignatureLegacy', () => {
  it('produces a deterministic 32-byte hex key using keccak256', () => {
    const key1 = deriveKeyFromSignatureLegacy(TEST_SIG);
    const key2 = deriveKeyFromSignatureLegacy(TEST_SIG);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('importKeyFromHex', () => {
  it('imports a 32-byte hex key as CryptoKey', async () => {
    const hexKey = deriveKeyFromSignature(TEST_SIG);
    const cryptoKey = await importKeyFromHex(hexKey);
    expect(cryptoKey).toBeDefined();
    expect(cryptoKey.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
  });

  it('accepts keys without 0x prefix', async () => {
    const hexKey = deriveKeyFromSignature(TEST_SIG).slice(2);
    const cryptoKey = await importKeyFromHex(hexKey);
    expect(cryptoKey).toBeDefined();
  });

  it('rejects invalid key length', async () => {
    await expect(importKeyFromHex('0xabcd')).rejects.toThrow('Invalid key length');
  });
});

describe('encryptValue / decryptValue roundtrip', () => {
  let key: CryptoKey;

  // Use a fixed test key
  const TEST_KEY_HEX = '0x' + '01'.repeat(32);

  async function getKey(): Promise<CryptoKey> {
    if (!key) {
      key = await importKeyFromHex(TEST_KEY_HEX);
    }
    return key;
  }

  it('roundtrips a string', async () => {
    const k = await getKey();
    const encrypted = await encryptValue(k, "hello world");
    expect(encrypted).toMatch(/^__cenc_v1_str:/);
    expect(isClientEncrypted(encrypted)).toBe(true);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toBe("hello world");
  });

  it('roundtrips an empty string', async () => {
    const k = await getKey();
    const encrypted = await encryptValue(k, "");
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toBe("");
  });

  it('roundtrips an integer', async () => {
    const k = await getKey();
    const encrypted = await encryptValue(k, 42);
    expect(encrypted).toMatch(/^__cenc_v1_int:/);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toBe(42);
  });

  it('roundtrips zero', async () => {
    const k = await getKey();
    const decrypted = await decryptValue(k, await encryptValue(k, 0));
    expect(decrypted).toBe(0);
  });

  it('roundtrips negative integers', async () => {
    const k = await getKey();
    const decrypted = await decryptValue(k, await encryptValue(k, -99));
    expect(decrypted).toBe(-99);
  });

  it('roundtrips a float', async () => {
    const k = await getKey();
    const encrypted = await encryptValue(k, 3.14);
    expect(encrypted).toMatch(/^__cenc_v1_float:/);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toBeCloseTo(3.14);
  });

  it('roundtrips a boolean (true)', async () => {
    const k = await getKey();
    const encrypted = await encryptValue(k, true);
    expect(encrypted).toMatch(/^__cenc_v1_bool:/);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toBe(true);
  });

  it('roundtrips a boolean (false)', async () => {
    const k = await getKey();
    const decrypted = await decryptValue(k, await encryptValue(k, false));
    expect(decrypted).toBe(false);
  });

  it('roundtrips null', async () => {
    const k = await getKey();
    const encrypted = await encryptValue(k, null);
    expect(encrypted).toMatch(/^__cenc_v1_null:/);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toBe(null);
  });

  it('roundtrips an array', async () => {
    const k = await getKey();
    const arr = [1, "two", true];
    const encrypted = await encryptValue(k, arr);
    expect(encrypted).toMatch(/^__cenc_v1_arr:/);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toEqual(arr);
  });

  it('roundtrips an object', async () => {
    const k = await getKey();
    const obj = { name: "test", count: 5 };
    const encrypted = await encryptValue(k, obj);
    expect(encrypted).toMatch(/^__cenc_v1_obj:/);
    const decrypted = await decryptValue(k, encrypted);
    expect(decrypted).toEqual(obj);
  });

  it('produces different ciphertext for same value (random nonce)', async () => {
    const k = await getKey();
    const enc1 = await encryptValue(k, "same");
    const enc2 = await encryptValue(k, "same");
    expect(enc1).not.toBe(enc2); // different nonce each time
    // But both decrypt to the same value
    expect(await decryptValue(k, enc1)).toBe("same");
    expect(await decryptValue(k, enc2)).toBe("same");
  });

  it('fails to decrypt with wrong key', async () => {
    const k1 = await importKeyFromHex('0x' + '01'.repeat(32));
    const k2 = await importKeyFromHex('0x' + '02'.repeat(32));
    const encrypted = await encryptValue(k1, "secret");
    await expect(decryptValue(k2, encrypted)).rejects.toThrow();
  });

  it('throws on non-encrypted input', async () => {
    const k = await getKey();
    await expect(decryptValue(k, "plaintext")).rejects.toThrow("Not a client-encrypted value");
  });
});

describe('encryptProperties', () => {
  it('encrypts all properties and wraps in KFDB String type', async () => {
    const k = await importKeyFromHex('0x' + '01'.repeat(32));
    const props = {
      name: "test",
      count: 42,
      active: true,
    };
    const encrypted = await encryptProperties(k, props);

    expect(Object.keys(encrypted)).toEqual(["name", "count", "active"]);

    // Each value is wrapped as { String: "__cenc_v1_..." }
    for (const v of Object.values(encrypted)) {
      const wrapper = v as { String: string };
      expect(wrapper).toHaveProperty("String");
      expect(wrapper.String).toMatch(/^__cenc_v1_/);
    }
  });

  it('unwraps KFDB type wrappers before encrypting', async () => {
    const k = await importKeyFromHex('0x' + '01'.repeat(32));
    const props = {
      name: { String: "hello" },
      count: { Integer: 42 },
      score: { Float: 3.14 },
      active: { Boolean: true },
    };
    const encrypted = await encryptProperties(k, props);

    // Decrypt the values to verify they were unwrapped correctly
    for (const [key, v] of Object.entries(encrypted)) {
      const wrapper = v as { String: string };
      const decrypted = await decryptValue(k, wrapper.String);
      if (key === "name") expect(decrypted).toBe("hello");
      if (key === "count") expect(decrypted).toBe(42);
      if (key === "score") expect(decrypted).toBeCloseTo(3.14);
      if (key === "active") expect(decrypted).toBe(true);
    }
  });
});

describe('decryptResponseRows', () => {
  it('decrypts encrypted values and passes through plaintext', async () => {
    const k = await importKeyFromHex('0x' + '01'.repeat(32));
    const encName = await encryptValue(k, "secret-name");
    const encCount = await encryptValue(k, 99);

    const rows = [
      {
        name: { String: encName },
        label: "File",           // not encrypted
        count: encCount,         // encrypted, no KFDB wrapper
      },
    ];

    const result = await decryptResponseRows(k, rows);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("secret-name");
    expect(result[0].label).toBe("File"); // unchanged
    expect(result[0].count).toBe(99);
  });

  it('handles empty rows', async () => {
    const k = await importKeyFromHex('0x' + '01'.repeat(32));
    const result = await decryptResponseRows(k, []);
    expect(result).toEqual([]);
  });
});

describe('isClientEncrypted', () => {
  it('returns true for cenc-prefixed strings', () => {
    expect(isClientEncrypted("__cenc_v1_str:abc")).toBe(true);
  });

  it('returns false for plain strings', () => {
    expect(isClientEncrypted("hello")).toBe(false);
  });

  it('returns false for server-encrypted strings', () => {
    expect(isClientEncrypted("__enc_v1_str:abc")).toBe(false);
  });
});
