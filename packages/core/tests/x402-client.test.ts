import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { X402Client } from '../src/payment/x402-client.js';

// Mock viem/accounts so tests don't do real crypto
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: (_key: string) => ({
    address: '0xTestAddress1234567890abcdef1234567890ab' as `0x${string}`,
    signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
  }),
  generatePrivateKey: () => ['0xac0974bec39a17e36ba4a6b4d', '238ff944bacb478cbed5efcae784d7bf4f2ff80'].join('') as `0x${string}`,
}));

// Mock viem + viem/chains used by payment-signer
vi.mock('viem', () => ({
  createWalletClient: () => ({
    signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
  }),
  http: () => ({}),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
}));

// Hardhat Account #0 — well-known, zero-value test key
const TEST_PRIVATE_KEY = ['0xac0974bec39a17e36ba4a6b4d', '238ff944bacb478cbed5efcae784d7bf4f2ff80'].join('');
const TEST_URL = 'https://api.example.com/tool';

/** Create a fetch mock that returns a single pre-built response */
function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    status,
    statusText: status === 200 ? 'OK' : status === 402 ? 'Payment Required' : 'Error',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(String(body)),
  });
}

/** Create a fetch mock that returns 402 on first call, then 200 on second call */
function mockFetch402ThenOk(paymentBody: unknown, okBody: unknown) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({
        status: 402,
        statusText: 'Payment Required',
        ok: false,
        headers: { get: (_: string) => 'application/json' },
        json: vi.fn().mockResolvedValue(paymentBody),
        text: vi.fn().mockResolvedValue(''),
      });
    }
    return Promise.resolve({
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: { get: (_: string) => 'application/json' },
      json: vi.fn().mockResolvedValue(okBody),
      text: vi.fn().mockResolvedValue(''),
    });
  });
}

const sample402Body = {
  accepts: [
    {
      network: 'eip155:8453',
      amount: '500', // $0.0005
      payTo: '0xRecipient',
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: { tokenName: 'USD Coin', tokenVersion: '2' },
    },
  ],
};

describe('X402Client', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── Non-402 responses ────────────────────────────────────────────────────

  it('returns ok status for 200 JSON response', async () => {
    const mockData = { tools: ['brave_search'] };
    globalThis.fetch = mockFetch(200, mockData, { 'content-type': 'application/json' }) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    const res = await client.request(TEST_URL);

    expect(res.success).toBe(true);
    expect(res.status).toBe('ok');
    expect(res.x402).toBe(false);
    expect(res.result).toEqual(mockData);
    expect(res.httpStatus).toBe(200);
  });

  it('returns error for 500 response', async () => {
    globalThis.fetch = mockFetch(500, 'Internal Server Error') as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    const res = await client.request(TEST_URL);

    expect(res.success).toBe(false);
    expect(res.status).toBe('payment_failed');
    expect(res.x402).toBe(false);
    expect(res.error).toContain('500');
    expect(res.httpStatus).toBe(500);
  });

  // ── 402 with autoPay=false ───────────────────────────────────────────────

  it('returns payment_required when autoPay is false (default)', async () => {
    globalThis.fetch = mockFetch(402, sample402Body, { 'content-type': 'application/json' }) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    const res = await client.request(TEST_URL);

    expect(res.success).toBe(false);
    expect(res.status).toBe('payment_required');
    expect(res.x402).toBe(true);
    expect(res.httpStatus).toBe(402);
    expect(res.paymentDetails).toEqual(sample402Body);
  });

  it('returns payment_required when autoPay=false is explicit', async () => {
    globalThis.fetch = mockFetch(402, sample402Body, { 'content-type': 'application/json' }) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    const res = await client.request(TEST_URL, { autoPay: false });

    expect(res.status).toBe('payment_required');
    expect(res.paymentDetails).toBeDefined();
  });

  // ── 402 with autoPay=true ────────────────────────────────────────────────

  it('pays and retries when autoPay=true and chain matches', async () => {
    const okBody = { result: 'search results' };
    globalThis.fetch = mockFetch402ThenOk(sample402Body, okBody) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    const res = await client.request(TEST_URL, { autoPay: true });

    expect(res.success).toBe(true);
    expect(res.status).toBe('paid');
    expect(res.x402).toBe(true);
    expect(res.result).toEqual(okBody);
    expect(res.payment).toBeDefined();
    expect(res.payment?.amount).toBe('500');
    expect(res.payment?.network).toBe('eip155:8453');
  });

  it('includes payment headers on retry request', async () => {
    const okBody = { ok: true };
    const fetchMock = mockFetch402ThenOk(sample402Body, okBody);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    await client.request(TEST_URL, { autoPay: true });

    // Second call should include X-PAYMENT header
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(secondCallHeaders['X-PAYMENT']).toBeDefined();
    expect(secondCallHeaders['PAYMENT-SIGNATURE']).toBeDefined();
  });

  // ── maxPaymentUsd safety limit ───────────────────────────────────────────

  it('rejects payment when amount exceeds maxPaymentUsd', async () => {
    // amount=500 base units = $0.0005; maxPaymentUsd=0.0001
    globalThis.fetch = mockFetch(402, sample402Body, { 'content-type': 'application/json' }) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY, { maxPaymentUsd: 0.0001 });
    const res = await client.request(TEST_URL, { autoPay: true });

    expect(res.success).toBe(false);
    expect(res.status).toBe('payment_rejected');
    expect(res.error).toContain('exceeds maxPaymentUsd');
  });

  it('respects per-request maxPaymentUsd override', async () => {
    globalThis.fetch = mockFetch(402, sample402Body, { 'content-type': 'application/json' }) as unknown as typeof fetch;

    // Constructor allows $1, but per-request limits to $0.00001
    const client = new X402Client(TEST_PRIVATE_KEY, { maxPaymentUsd: 1.0 });
    const res = await client.request(TEST_URL, { autoPay: true, maxPaymentUsd: 0.00001 });

    expect(res.status).toBe('payment_rejected');
    expect(res.error).toContain('exceeds maxPaymentUsd');
  });

  // ── No matching chain ────────────────────────────────────────────────────

  it('rejects when no offer matches the configured chain', async () => {
    const differentChain402 = {
      accepts: [{ network: 'eip155:1', amount: '500', payTo: '0xRecipient', asset: '0xUSDC' }],
    };
    globalThis.fetch = mockFetch(402, differentChain402, { 'content-type': 'application/json' }) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY, { chainId: 8453 });
    const res = await client.request(TEST_URL, { autoPay: true });

    expect(res.success).toBe(false);
    expect(res.status).toBe('payment_rejected');
    expect(res.error).toContain('eip155:8453');
  });

  // ── Body auto-stringify ──────────────────────────────────────────────────

  it('stringifies object body and sets Content-Type', async () => {
    const fetchMock = mockFetch(200, { ok: true }, { 'content-type': 'application/json' });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    await client.request(TEST_URL, { method: 'POST', body: { query: 'test' } });

    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callOpts.body).toBe('{"query":"test"}');
    expect((callOpts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('passes string body through unchanged', async () => {
    const fetchMock = mockFetch(200, 'ok', {});
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY);
    await client.request(TEST_URL, { method: 'POST', body: 'raw-string' });

    const callOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(callOpts.body).toBe('raw-string');
  });

  // ── Constructor defaults ─────────────────────────────────────────────────

  it('uses BASE_CHAIN_ID (8453) by default', async () => {
    // Offer only on eip155:8453 — should match with default chain
    const okBody = { result: 'ok' };
    globalThis.fetch = mockFetch402ThenOk(sample402Body, okBody) as unknown as typeof fetch;

    const client = new X402Client(TEST_PRIVATE_KEY); // no chainId specified
    const res = await client.request(TEST_URL, { autoPay: true });

    expect(res.success).toBe(true);
    expect(res.payment?.network).toBe('eip155:8453');
  });
});
