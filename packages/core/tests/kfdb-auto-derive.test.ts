import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KFDBClient } from '../src/kfdb/client.js';
import { MemoryDeriveSessionStore } from '../src/kfdb/derive-session-store.js';

// Mock signature (65 bytes = 130 hex chars)
const MOCK_SIG = '0x' + 'ab'.repeat(32) + 'cd'.repeat(32) + '1b';
const MOCK_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const MOCK_SESSION_ID = 'test-session-123';
const MOCK_EXPIRES_AT = Date.now() + 3600_000; // 1 hour from now

describe('MemoryDeriveSessionStore', () => {
  it('returns null for unknown address', async () => {
    const store = new MemoryDeriveSessionStore();
    expect(await store.get('0xunknown')).toBeNull();
  });

  it('stores and retrieves sessions', async () => {
    const store = new MemoryDeriveSessionStore();
    const session = {
      sessionId: MOCK_SESSION_ID,
      keyHex: '0x' + 'aa'.repeat(32),
      expiresAt: MOCK_EXPIRES_AT,
      address: MOCK_ADDRESS,
    };

    await store.set(MOCK_ADDRESS, session);
    const retrieved = await store.get(MOCK_ADDRESS);
    expect(retrieved).toEqual(session);
  });

  it('normalizes address to lowercase', async () => {
    const store = new MemoryDeriveSessionStore();
    const session = {
      sessionId: MOCK_SESSION_ID,
      keyHex: '0x' + 'aa'.repeat(32),
      expiresAt: MOCK_EXPIRES_AT,
      address: MOCK_ADDRESS,
    };

    await store.set('0xABCD', session);
    expect(await store.get('0xabcd')).toEqual(session);
  });

  it('clears sessions', async () => {
    const store = new MemoryDeriveSessionStore();
    await store.set(MOCK_ADDRESS, {
      sessionId: MOCK_SESSION_ID,
      keyHex: '0x' + 'aa'.repeat(32),
      expiresAt: MOCK_EXPIRES_AT,
      address: MOCK_ADDRESS,
    });

    await store.clear(MOCK_ADDRESS);
    expect(await store.get(MOCK_ADDRESS)).toBeNull();
  });
});

describe('KFDBClient.autoDerive', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  function mockDeriveEndpoints() {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url.toString();

      if (urlStr.includes('/api/v1/auth/derive-challenge')) {
        return new Response(JSON.stringify({
          challenge_id: 'challenge-abc',
          typed_data: { types: {}, primaryType: 'Derive', domain: {}, message: {} },
        }), { status: 200 });
      }

      if (urlStr.includes('/api/v1/auth/derive-key')) {
        return new Response(JSON.stringify({
          session_id: MOCK_SESSION_ID,
          expires_at: MOCK_EXPIRES_AT,
        }), { status: 200 });
      }

      return new Response('Not found', { status: 404 });
    });
  }

  it('throws without walletAddress', async () => {
    const client = new KFDBClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
    });

    await expect(
      client.autoDerive(async () => MOCK_SIG),
    ).rejects.toThrow('autoDerive requires walletAddress');
  });

  it('performs full derive flow', async () => {
    mockDeriveEndpoints();

    const client = new KFDBClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      walletAddress: MOCK_ADDRESS,
    });

    const signFn = vi.fn().mockResolvedValue(MOCK_SIG);
    await client.autoDerive(signFn);

    // Should have called challenge + derive-key endpoints
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signFn).toHaveBeenCalledTimes(1);

    // Typed data should have been passed to signFn
    expect(signFn).toHaveBeenCalledWith(
      expect.objectContaining({ primaryType: 'Derive' }),
    );
  });

  it('uses cached session from store', async () => {
    const store = new MemoryDeriveSessionStore();
    await store.set(MOCK_ADDRESS, {
      sessionId: MOCK_SESSION_ID,
      keyHex: '0x' + 'aa'.repeat(32),
      expiresAt: Date.now() + 3600_000, // valid for 1 hour
      address: MOCK_ADDRESS,
    });

    const client = new KFDBClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      walletAddress: MOCK_ADDRESS,
    });

    const signFn = vi.fn().mockResolvedValue(MOCK_SIG);
    await client.autoDerive(signFn, { sessionStore: store });

    // Should NOT have called any endpoints — used cache
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signFn).not.toHaveBeenCalled();
  });

  it('re-derives when cached session is expired', async () => {
    mockDeriveEndpoints();

    const store = new MemoryDeriveSessionStore();
    await store.set(MOCK_ADDRESS, {
      sessionId: 'old-session',
      keyHex: '0x' + 'aa'.repeat(32),
      expiresAt: Date.now() - 1000, // already expired
      address: MOCK_ADDRESS,
    });

    const client = new KFDBClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      walletAddress: MOCK_ADDRESS,
    });

    const signFn = vi.fn().mockResolvedValue(MOCK_SIG);
    await client.autoDerive(signFn, { sessionStore: store });

    // Should have called endpoints to re-derive
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signFn).toHaveBeenCalledTimes(1);

    // Store should have the new session
    const cached = await store.get(MOCK_ADDRESS);
    expect(cached?.sessionId).toBe(MOCK_SESSION_ID);
  });

  it('persists new session to store', async () => {
    mockDeriveEndpoints();

    const store = new MemoryDeriveSessionStore();
    const client = new KFDBClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      walletAddress: MOCK_ADDRESS,
    });

    await client.autoDerive(async () => MOCK_SIG, { sessionStore: store });

    const cached = await store.get(MOCK_ADDRESS);
    expect(cached).not.toBeNull();
    expect(cached!.sessionId).toBe(MOCK_SESSION_ID);
    expect(cached!.address).toBe(MOCK_ADDRESS);
  });
});
