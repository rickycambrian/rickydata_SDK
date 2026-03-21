import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthManager } from '../src/auth.js';
import { ToolsManager } from '../src/tools.js';
import type { EIP712SignedOffer, EIP712SignedReceipt } from '../src/types/offer-receipt.js';

const BASE = 'http://localhost:8080';

function headersForFetchCall(index: number): Headers {
  const [requestLike, init] = vi.mocked(fetch).mock.calls[index];
  if (requestLike instanceof Request) return requestLike.headers;
  return new Headers((init?.headers ?? {}) as HeadersInit);
}

describe('ToolsManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    vi.restoreAllMocks();
    auth = new AuthManager(BASE, 'test-token');
  });

  it('lists tools for a server', async () => {
    const mockTools = [
      { name: 'search', description: 'Search the web' },
      { name: 'summarize', description: 'Summarize text' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tools: mockTools }),
    } as Response);

    const tools = new ToolsManager(BASE, auth, null, true);
    const result = await tools.listTools('server-1');

    expect(result).toEqual(mockTools);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${BASE}/api/servers/server-1/tools`);
    const headers = headersForFetchCall(0);
    expect(headers.get('authorization')).toBe('Bearer test-token');
  });

  it('calls a tool successfully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: 'result data', isError: false }),
    } as Response);

    const tools = new ToolsManager(BASE, auth, null, true);
    const result = await tools.callTool('server-1', 'search', { query: 'test' });

    expect(result.content).toBe('result data');
    expect(result.isError).toBe(false);

    // Verify args are sent directly, not wrapped in { args: {...} }
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(fetchCall[1]?.body as string);
    expect(body).toEqual({ query: 'test' });
    expect(body.args).toBeUndefined();
  });

  it('throws on tool call failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Error'),
    } as Response);

    const tools = new ToolsManager(BASE, auth, null, true);
    await expect(tools.callTool('server-1', 'search', {})).rejects.toThrow('Tool call failed: 500');
  });

  it('does not auto-sign without wallet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: () => Promise.resolve('Payment required'),
    } as Response);

    const tools = new ToolsManager(BASE, auth, null, true);
    await expect(tools.callTool('server-1', 'search', {})).rejects.toThrow('Tool call failed: 402');
  });

  it('does not auto-sign when disabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: () => Promise.resolve('Payment required'),
    } as Response);

    // Even with a mock wallet object, autoSign=false should skip payment
    const tools = new ToolsManager(BASE, auth, null, false);
    await expect(tools.callTool('server-1', 'search', {})).rejects.toThrow('Tool call failed: 402');
  });

  it('tracks spending with no wallet', () => {
    const tools = new ToolsManager(BASE, auth, null, true);
    const spending = tools.getSpending();
    expect(spending.totalSpent).toBe(0);
    expect(spending.callCount).toBe(0);
  });

  it('does not retry infinitely on double 402', async () => {
    // First call returns 402 with CAIP-2 network, retry with payment also returns 402
    const mock402 = {
      ok: false,
      status: 402,
      json: () => Promise.resolve({
        accepts: [{
          scheme: 'exact', network: 'eip155:8453', amount: '500', maxAmountRequired: '500',
          payTo: '0x0000000000000000000000000000000000000001',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          extra: { name: 'USD Coin', version: '2' },
        }],
        x402Version: 2,
      }),
      text: () => Promise.resolve('Payment required again'),
    } as unknown as Response;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mock402) // First call → 402
      .mockResolvedValueOnce({ ...mock402, json: undefined, text: () => Promise.resolve('Still 402') } as unknown as Response); // Retry → still 402

    // Create a mock wallet that signs successfully
    const mockWallet = {
      signPayment: vi.fn().mockResolvedValue({ header: 'fake-header', receipt: {} }),
      recordFailure: vi.fn(),
      getSpending: vi.fn().mockReturnValue({ totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 }),
    } as any;

    const tools = new ToolsManager(BASE, auth, mockWallet, true);
    await expect(tools.callTool('server-1', 'search', {})).rejects.toThrow('Tool call failed: 402');

    // Should have called fetch exactly twice (initial + one retry), not more
    expect(fetch).toHaveBeenCalledTimes(2);
    // signPayment called exactly once
    expect(mockWallet.signPayment).toHaveBeenCalledTimes(1);
  });

  it('sends PAYMENT-SIGNATURE header (v2) with X-Payment fallback', async () => {
    // 402 → sign → retry with both headers → success
    const mock402 = {
      ok: false,
      status: 402,
      json: () => Promise.resolve({
        accepts: [{
          scheme: 'exact', network: 'eip155:8453', amount: '500',
          payTo: '0x0000000000000000000000000000000000000001',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          extra: { name: 'USD Coin', version: '2' },
        }],
        x402Version: 2,
      }),
    } as unknown as Response;

    const mockSuccess = {
      ok: true,
      json: () => Promise.resolve({ content: 'paid result', isError: false }),
    } as Response;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mock402)
      .mockResolvedValueOnce(mockSuccess);

    const mockWallet = {
      signPayment: vi.fn().mockResolvedValue({ header: 'signed-payment-header', receipt: {} }),
      recordFailure: vi.fn(),
      getSpending: vi.fn().mockReturnValue({ totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 }),
    } as any;

    const tools = new ToolsManager(BASE, auth, mockWallet, true);
    const result = await tools.callTool('server-1', 'search', { q: 'test' });

    expect(result.content).toBe('paid result');

    // Verify both v2 and v1 headers are sent on retry
    const retryHeaders = headersForFetchCall(1);
    expect(retryHeaders.get('payment-signature')).toBe('signed-payment-header');
    expect(retryHeaders.get('x-payment')).toBe('signed-payment-header');
  });

  it('parses CAIP-2 network format from 402 response', async () => {
    // 402 response uses CAIP-2 network "eip155:8453"
    const mock402 = {
      ok: false,
      status: 402,
      json: () => Promise.resolve({
        accepts: [{
          scheme: 'exact', network: 'eip155:84532', amount: '1000',
          payTo: '0x0000000000000000000000000000000000000002',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          extra: { name: 'USD Coin', version: '2' },
        }],
        x402Version: 2,
      }),
    } as unknown as Response;

    const mockSuccess = {
      ok: true,
      json: () => Promise.resolve({ content: 'ok', isError: false }),
    } as Response;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mock402)
      .mockResolvedValueOnce(mockSuccess);

    const mockWallet = {
      signPayment: vi.fn().mockResolvedValue({ header: 'h', receipt: {} }),
      recordFailure: vi.fn(),
      getSpending: vi.fn().mockReturnValue({ totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 }),
    } as any;

    const tools = new ToolsManager(BASE, auth, mockWallet, true);
    await tools.callTool('server-1', 'search', {});

    // Verify signPayment was called with correct chainId parsed from CAIP-2
    const callArgs = mockWallet.signPayment.mock.calls[0];
    const requirements = callArgs[0];
    expect(requirements.chainId).toBe(84532); // Base Sepolia from "eip155:84532"
    expect(requirements.network).toBe('eip155:84532');
    expect(requirements.amount).toBe('1000');
    expect(requirements.usdcContract).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('throws on fetch timeout (AbortError)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    );

    const tools = new ToolsManager(BASE, auth, null, true);
    await expect(tools.callTool('server-1', 'search', {})).rejects.toThrow('aborted');
  });

  describe('401 auto-re-auth', () => {
    it('retries callTool on 401 after re-authenticating', async () => {
      // Set up auth with stored credentials (test mode)
      const freshAuth = new AuthManager(BASE);
      vi.spyOn(globalThis, 'fetch')
        // authenticate → success
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-1', expiresAt: Date.now() + 86400000 }),
        } as Response)
        // callTool → 401 (expired)
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Session expired'),
        } as Response)
        // reauthenticate → new token
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-2', expiresAt: Date.now() + 86400000 }),
        } as Response)
        // callTool retry → success
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: 'result', isError: false }),
        } as Response);

      await freshAuth.authenticate();
      const tools = new ToolsManager(BASE, freshAuth, null, true);
      const result = await tools.callTool('server-1', 'search', { q: 'hello' });

      expect(result.content).toBe('result');
      // authenticate(1) + callTool(2) + reauthenticate(3) + retry(4)
      expect(fetch).toHaveBeenCalledTimes(4);
      // The retry should use the fresh token
      const retryHeaders = headersForFetchCall(3);
      expect(retryHeaders.get('authorization')).toBe('Bearer jwt-2');
    });

    it('retries listTools on 401 after re-authenticating', async () => {
      const freshAuth = new AuthManager(BASE);
      vi.spyOn(globalThis, 'fetch')
        // authenticate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-1' }),
        } as Response)
        // listTools → 401
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Expired'),
        } as Response)
        // reauthenticate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-2' }),
        } as Response)
        // listTools retry → success
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tools: [{ name: 'search' }] }),
        } as Response);

      await freshAuth.authenticate();
      const tools = new ToolsManager(BASE, freshAuth, null, true);
      const result = await tools.listTools('server-1');

      expect(result).toEqual([{ name: 'search' }]);
      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('does not retry 401 without stored credentials', async () => {
      // AuthManager created with static token — no stored credentials
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Expired'),
      } as Response);

      const tools = new ToolsManager(BASE, auth, null, true);
      await expect(tools.callTool('server-1', 'search', {})).rejects.toThrow('Tool call failed: 401');
      // Only one fetch — no retry attempt
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('proactively re-auths when token is known expired', async () => {
      const freshAuth = new AuthManager(BASE);
      vi.spyOn(globalThis, 'fetch')
        // authenticate with already-expired token
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-expired', expiresAt: Date.now() - 1000 }),
        } as Response)
        // proactive reauthenticate
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ token: 'jwt-fresh', expiresAt: Date.now() + 86400000 }),
        } as Response)
        // callTool succeeds on first try (no 401)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ content: 'ok', isError: false }),
        } as Response);

      await freshAuth.authenticate();
      expect(freshAuth.isExpired).toBe(true);

      const tools = new ToolsManager(BASE, freshAuth, null, true);
      const result = await tools.callTool('server-1', 'search', {});

      expect(result.content).toBe('ok');
      // authenticate(1) + proactive-reauth(2) + callTool(3) = 3 total
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('offer-receipt extension', () => {
    it('extracts offers from 402 response with extensions field', async () => {
      const offer: EIP712SignedOffer = {
        format: 'eip712',
        payload: {
          version: 1,
          resourceUrl: `${BASE}/api/servers/server-1/tools/search`,
          scheme: 'exact',
          network: 'eip155:8453',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0x2c241F8509BB6a7b672a440DFebd332cB0B258DE',
          amount: '500',
          validUntil: 9999999999,
        },
        signature: '0xoffersig',
      };

      const receipt: EIP712SignedReceipt = {
        format: 'eip712',
        payload: {
          version: 1,
          network: 'eip155:8453',
          resourceUrl: `${BASE}/api/servers/server-1/tools/search`,
          payer: '0xpayer',
          issuedAt: Math.floor(Date.now() / 1000),
          transaction: '0xtxhash',
        },
        signature: '0xreceiptsig',
      };

      const mock402 = {
        ok: false,
        status: 402,
        json: () => Promise.resolve({
          accepts: [{
            scheme: 'exact',
            network: 'eip155:8453',
            amount: '500',
            maxAmountRequired: '500',
            payTo: '0x2c241F8509BB6a7b672a440DFebd332cB0B258DE',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            extra: { name: 'USD Coin', version: '2' },
          }],
          x402Version: 2,
          extensions: {
            'offer-receipt': {
              info: { offers: [offer] },
            },
          },
        }),
      } as unknown as Response;

      let recordedReceipt: any = null;
      const mockWallet = {
        signPayment: vi.fn().mockResolvedValue({ header: 'signed-header', receipt: {} }),
        recordFailure: vi.fn(),
        getSpending: vi.fn().mockReturnValue({ totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 }),
        recordServerReceipt: vi.fn((r: any) => { recordedReceipt = r; }),
      } as any;

      const mockSuccess = {
        ok: true,
        headers: new Headers({ 'PAYMENT-RESPONSE': btoa(JSON.stringify({
          extensions: { 'offer-receipt': { info: { receipt } } },
        })) }),
        json: () => Promise.resolve({ content: 'paid result', isError: false }),
      } as unknown as Response;

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mock402)
        .mockResolvedValueOnce(mockSuccess);

      const tools = new ToolsManager(BASE, auth, mockWallet, true);
      const result = await tools.callTool('server-1', 'search', {});

      expect(result.content).toBe('paid result');
      // Receipt should be recorded with the offer paired
      expect(mockWallet.recordServerReceipt).toHaveBeenCalledTimes(1);
      expect(recordedReceipt.receipt.signature).toBe('0xreceiptsig');
      expect(recordedReceipt.offer.signature).toBe('0xoffersig');
      expect(recordedReceipt.toolName).toBe('search');
      expect(recordedReceipt.serverId).toBe('server-1');
    });

    it('succeeds normally on 402 without extensions (backward compat)', async () => {
      const mock402 = {
        ok: false,
        status: 402,
        json: () => Promise.resolve({
          accepts: [{
            scheme: 'exact',
            network: 'eip155:8453',
            amount: '500',
            maxAmountRequired: '500',
            payTo: '0x0000000000000000000000000000000000000001',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            extra: { name: 'USD Coin', version: '2' },
          }],
          x402Version: 2,
          // no extensions field
        }),
      } as unknown as Response;

      const mockWallet = {
        signPayment: vi.fn().mockResolvedValue({ header: 'h', receipt: {} }),
        recordFailure: vi.fn(),
        getSpending: vi.fn().mockReturnValue({ totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 }),
        recordServerReceipt: vi.fn(),
      } as any;

      const mockSuccess = {
        ok: true,
        headers: new Headers(),
        json: () => Promise.resolve({ content: 'ok', isError: false }),
      } as unknown as Response;

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mock402)
        .mockResolvedValueOnce(mockSuccess);

      const tools = new ToolsManager(BASE, auth, mockWallet, true);
      const result = await tools.callTool('server-1', 'search', {});

      expect(result.content).toBe('ok');
      // No receipt extracted, so recordServerReceipt not called
      expect(mockWallet.recordServerReceipt).not.toHaveBeenCalled();
    });

    it('extracts receipt from PAYMENT-RESPONSE header on 200 (no 402 flow)', async () => {
      const receipt: EIP712SignedReceipt = {
        format: 'eip712',
        payload: {
          version: 1,
          network: 'eip155:8453',
          resourceUrl: `${BASE}/api/servers/server-1/tools/search`,
          payer: '0xpayer',
          issuedAt: Math.floor(Date.now() / 1000),
          transaction: '0xtx',
        },
        signature: '0xreceiptonlysig',
      };

      let recordedReceipt: any = null;
      const mockWallet = {
        signPayment: vi.fn(),
        recordFailure: vi.fn(),
        getSpending: vi.fn().mockReturnValue({ totalSpent: 0, sessionSpent: 0, daySpent: 0, weekSpent: 0, callCount: 0 }),
        recordServerReceipt: vi.fn((r: any) => { recordedReceipt = r; }),
      } as any;

      const mockSuccess = {
        ok: true,
        headers: new Headers({ 'PAYMENT-RESPONSE': btoa(JSON.stringify({
          extensions: { 'offer-receipt': { info: { receipt } } },
        })) }),
        json: () => Promise.resolve({ content: 'direct result', isError: false }),
      } as unknown as Response;

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockSuccess);

      const tools = new ToolsManager(BASE, auth, mockWallet, true);
      const result = await tools.callTool('server-1', 'search', {});

      expect(result.content).toBe('direct result');
      expect(mockWallet.recordServerReceipt).toHaveBeenCalledTimes(1);
      expect(recordedReceipt.receipt.signature).toBe('0xreceiptonlysig');
      expect(recordedReceipt.offer).toBeUndefined();
    });
  });
});
