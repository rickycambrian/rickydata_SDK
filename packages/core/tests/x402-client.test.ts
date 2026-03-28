import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  signPayment: vi.fn(),
}));

vi.mock('../src/payment/payment-signer.js', () => ({
  signPayment: mocks.signPayment,
}));

import { X402Client } from '../src/payment/x402-client.js';

const TEST_PRIVATE_KEY = [
  '0xac0974bec39a17e36ba4a6b4d',
  '238ff944bacb478cbed5efcae784d7bf4f2ff80',
].join('');
const TEST_URL = 'https://api.example.com/tool';
const TEST_ACCOUNT = {
  address: '0x1111111111111111111111111111111111111111' as `0x${string}`,
  signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
};

function createResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    status,
    statusText: status === 200 ? 'OK' : status === 402 ? 'Payment Required' : 'Error',
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => normalizedHeaders[name.toLowerCase()] ?? null,
    },
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function mockFetchSequence(
  ...responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>
) {
  let index = 0;
  return vi.fn().mockImplementation(() => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(createResponse(response.status, response.body, response.headers));
  });
}

function createClient(options?: ConstructorParameters<typeof X402Client>[1]) {
  const client = new X402Client(TEST_PRIVATE_KEY, options);
  vi.spyOn(client as any, '_getAccount').mockResolvedValue(TEST_ACCOUNT);
  vi.spyOn(client as any, 'getTokenBalance').mockImplementation(
    async (_address: `0x${string}`, _tokenAddress: string, chainId: number) => mocks.readContract(chainId),
  );
  return client;
}

const baseOffer = {
  network: 'eip155:8453',
  amount: '500',
  payTo: '0xBaseRecipient',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  extra: { tokenName: 'USD Coin', tokenVersion: '2' },
};

const polygonOffer = {
  network: 'eip155:137',
  amount: '750',
  payTo: '0xPolygonRecipient',
  asset: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  extra: { tokenName: 'USD Coin', tokenVersion: '2' },
};

const unsupportedOffer = {
  network: 'solana:mainnet',
  amount: '500',
  payTo: 'SomeSolanaRecipient',
  asset: 'So11111111111111111111111111111111111111112',
};

describe('X402Client', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mocks.readContract.mockReset();
    mocks.signPayment.mockReset();
    mocks.signPayment.mockResolvedValue({
      header: 'signed-payment-header',
      receipt: {
        from: '0x1111111111111111111111111111111111111111',
        to: '0xPolygonRecipient',
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok status for a successful JSON response', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 200,
      body: { ok: true },
      headers: { 'content-type': 'application/json' },
    }) as unknown as typeof fetch;

    const client = createClient();
    const result = await client.request(TEST_URL);

    expect(result).toMatchObject({
      success: true,
      status: 'ok',
      x402: false,
      httpStatus: 200,
      result: { ok: true },
    });
  });

  it('returns payment_failed for non-402 HTTP errors', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 500,
      body: 'Internal Server Error',
    }) as unknown as typeof fetch;

    const client = createClient();
    const result = await client.request(TEST_URL);

    expect(result).toMatchObject({
      success: false,
      status: 'payment_failed',
      x402: false,
      httpStatus: 500,
    });
    expect(result.error).toContain('500');
  });

  it('returns payment_required preview with usable offers and the first funded selection', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 402,
      body: { accepts: [baseOffer, polygonOffer] },
      headers: { 'content-type': 'application/json' },
    }) as unknown as typeof fetch;

    mocks.readContract.mockImplementation(async (chainId: number) => {
      if (chainId === 8453) return 0n;
      if (chainId === 137) return 750n;
      throw new Error(`Unexpected chain ${chainId}`);
    });

    const client = createClient();
    const result = await client.request(TEST_URL);

    expect(result).toMatchObject({
      success: false,
      status: 'payment_required',
      x402: true,
      httpStatus: 402,
      paymentAttempted: false,
      selectedOffer: {
        network: 'eip155:137',
        chainId: 137,
        amount: '750',
      },
    });
    expect(result.usableOffers).toEqual([
      expect.objectContaining({
        network: 'eip155:8453',
        chainId: 8453,
        balance: '0',
        balanceSufficient: false,
      }),
      expect.objectContaining({
        network: 'eip155:137',
        chainId: 137,
        balance: '750',
        balanceSufficient: true,
      }),
    ]);
    expect(mocks.signPayment).not.toHaveBeenCalled();
  });

  it('auto-pays using the first funded supported offer in server order', async () => {
    const fetchMock = mockFetchSequence(
      {
        status: 402,
        body: { accepts: [baseOffer, polygonOffer] },
        headers: { 'content-type': 'application/json' },
      },
      {
        status: 200,
        body: { result: 'scan-complete' },
        headers: { 'content-type': 'application/json' },
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    mocks.readContract.mockImplementation(async (chainId: number) => {
      if (chainId === 8453) return 0n;
      if (chainId === 137) return 750n;
      throw new Error(`Unexpected chain ${chainId}`);
    });

    const client = createClient();
    const result = await client.request(TEST_URL, {
      autoPay: true,
      method: 'POST',
      body: '{"chain":"polygon","tokenAddress":"0xabc"}',
    });

    expect(result).toMatchObject({
      success: true,
      status: 'paid',
      x402: true,
      result: { result: 'scan-complete' },
      payment: {
        amount: '750',
        network: 'eip155:137',
      },
      selectedOffer: {
        network: 'eip155:137',
        chainId: 137,
      },
      paymentAttempted: true,
    });
    expect(mocks.signPayment).toHaveBeenCalledTimes(1);
    expect(mocks.signPayment).toHaveBeenCalledWith(
      expect.objectContaining({ address: '0x1111111111111111111111111111111111111111' }),
      expect.objectContaining({
        amount: '750',
        chainId: 137,
        network: 'eip155:137',
        recipient: '0xPolygonRecipient',
      }),
    );

    const retryOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((retryOptions.headers as Record<string, string>)['X-PAYMENT']).toBe('signed-payment-header');
    expect((retryOptions.headers as Record<string, string>)['PAYMENT-SIGNATURE']).toBe('signed-payment-header');
    expect(retryOptions.body).toBe('{"chain":"polygon","tokenAddress":"0xabc"}');
    expect((retryOptions.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('does not fall back when a strict payment chain is requested and that chain is unfunded', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 402,
      body: { accepts: [baseOffer, polygonOffer] },
      headers: { 'content-type': 'application/json' },
    }) as unknown as typeof fetch;

    mocks.readContract.mockImplementation(async (chainId: number) => {
      if (chainId === 8453) return 0n;
      if (chainId === 137) return 750n;
      throw new Error(`Unexpected chain ${chainId}`);
    });

    const client = createClient({ chainId: 8453, strictChainId: true });
    const result = await client.request(TEST_URL, { autoPay: true });

    expect(result).toMatchObject({
      success: false,
      status: 'payment_unfunded',
      x402: true,
      httpStatus: 402,
      paymentAttempted: false,
    });
    expect(result.error).toContain('eip155:8453');
    expect(mocks.signPayment).not.toHaveBeenCalled();
  });

  it('returns payment_rejected when only non-EVM offers are provided', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 402,
      body: { accepts: [unsupportedOffer] },
      headers: { 'content-type': 'application/json' },
    }) as unknown as typeof fetch;

    const client = createClient();
    const result = await client.request(TEST_URL, { autoPay: true });

    expect(result).toMatchObject({
      success: false,
      status: 'payment_rejected',
      x402: true,
      httpStatus: 402,
      paymentAttempted: false,
    });
    expect(result.error).toContain('No supported EVM payment offer available');
    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.signPayment).not.toHaveBeenCalled();
  });

  it('returns payment_unfunded without signing when no supported offer has enough balance', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 402,
      body: { accepts: [baseOffer, polygonOffer] },
      headers: { 'content-type': 'application/json' },
    }) as unknown as typeof fetch;

    mocks.readContract.mockResolvedValue(100n);

    const client = createClient();
    const result = await client.request(TEST_URL, { autoPay: true });

    expect(result).toMatchObject({
      success: false,
      status: 'payment_unfunded',
      x402: true,
      httpStatus: 402,
      paymentAttempted: false,
    });
    expect(result.error).toContain('No funded payment offer available');
    expect(mocks.signPayment).not.toHaveBeenCalled();
  });

  it('rejects payment when the selected offer exceeds maxPaymentUsd', async () => {
    globalThis.fetch = mockFetchSequence({
      status: 402,
      body: { accepts: [polygonOffer] },
      headers: { 'content-type': 'application/json' },
    }) as unknown as typeof fetch;

    mocks.readContract.mockResolvedValue(750n);

    const client = createClient({ maxPaymentUsd: 0.0001 });
    const result = await client.request(TEST_URL, { autoPay: true });

    expect(result).toMatchObject({
      success: false,
      status: 'payment_rejected',
      x402: true,
      httpStatus: 402,
      paymentAttempted: false,
    });
    expect(result.error).toContain('exceeds maxPaymentUsd');
    expect(mocks.signPayment).not.toHaveBeenCalled();
  });

  it('surfaces the retry failure reason when the paid retry is rejected', async () => {
    globalThis.fetch = mockFetchSequence(
      {
        status: 402,
        body: { accepts: [polygonOffer] },
        headers: { 'content-type': 'application/json' },
      },
      {
        status: 402,
        body: {
          error: {
            message: 'Insufficient token balance for settlement',
          },
        },
        headers: { 'content-type': 'application/json' },
      },
    ) as unknown as typeof fetch;

    mocks.readContract.mockResolvedValue(750n);

    const client = createClient();
    const result = await client.request(TEST_URL, { autoPay: true });

    expect(result).toMatchObject({
      success: false,
      status: 'payment_failed',
      x402: true,
      httpStatus: 402,
      serverReason: 'Insufficient token balance for settlement',
      paymentAttempted: true,
      selectedOffer: {
        network: 'eip155:137',
        chainId: 137,
      },
    });
    expect(result.error).toContain('Insufficient token balance for settlement');
    expect(mocks.signPayment).toHaveBeenCalledTimes(1);
  });

  it('stringifies object bodies and sets application/json', async () => {
    const fetchMock = mockFetchSequence({
      status: 200,
      body: { ok: true },
      headers: { 'content-type': 'application/json' },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createClient();
    await client.request(TEST_URL, { method: 'POST', body: { query: 'test' } });

    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestOptions.body).toBe('{"query":"test"}');
    expect((requestOptions.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('auto-detects JSON string bodies and preserves them on retry', async () => {
    const fetchMock = mockFetchSequence({
      status: 200,
      body: { ok: true },
      headers: { 'content-type': 'application/json' },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createClient();
    await client.request(TEST_URL, {
      method: 'POST',
      body: '{"chain":"base","tokenAddress":"0xcbB7C3aD147b6F346AB4D7D29F289E4A99F50078"}',
    });

    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestOptions.body).toBe('{"chain":"base","tokenAddress":"0xcbB7C3aD147b6F346AB4D7D29F289E4A99F50078"}');
    expect((requestOptions.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('does not set application/json for non-JSON string bodies', async () => {
    const fetchMock = mockFetchSequence({
      status: 200,
      body: 'ok',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createClient();
    await client.request(TEST_URL, { method: 'POST', body: 'plain text body' });

    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestOptions.body).toBe('plain text body');
    expect((requestOptions.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});
