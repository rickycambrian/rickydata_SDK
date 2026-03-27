import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPGateway } from '../src/client.js';
import { SpendingWallet } from '../src/wallet/spending-wallet.js';

// Mock viem for all tests
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: (key: string) => ({
    address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
    signTypedData: vi.fn().mockResolvedValue('0xmocksig'),
  }),
  generatePrivateKey: () => '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
}));

vi.mock('viem', () => ({
  createWalletClient: ({ account }: { account: unknown }) => ({
    signTypedData: vi.fn().mockResolvedValue('0xmocksignature'),
  }),
  http: () => ({}),
}));

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
}));

const BASE = 'http://localhost:8080';
const MOCK_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('Integration: MCPGateway + SpendingWallet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('full 402 flow: call -> 402 -> sign -> retry -> success', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(MOCK_KEY, {
      maxPerCall: 1, maxPerSession: 100, maxPerDay: 100, maxPerWeek: 100,
    });

    const gw = new MCPGateway({ url: BASE, spendingWallet: wallet });

    vi.spyOn(globalThis, 'fetch')
      // Auth
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt' }),
      } as Response)
      // TEE attestation (auto-enabled when spendingWallet is provided)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          attestation_available: true,
          platform: 'unknown',
          encryption_enabled: true,
        }),
      } as Response)
      // First call returns 402
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        json: () => Promise.resolve({
          accepts: [{
            maxAmountRequired: '500',
            payTo: '0xRecipient',
            asset: '0xUSDC',
            network: 'base',
            extra: { name: 'USD Coin', version: '2', priceUsd: '0.0005' },
          }],
        }),
      } as Response)
      // Retry with payment succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'search results', isError: false, payment: { verified: true, settled: true, amount: '0.0005' } }),
      } as Response);

    await gw.authenticate();
    const result = await gw.callTool('server-1', 'search', { query: 'test' });

    expect(result.content).toBe('search results');
    expect(result.isError).toBe(false);

    // Verify payment was tracked
    const spending = gw.getSpending();
    expect(spending.callCount).toBe(1);
    expect(spending.sessionSpent).toBeCloseTo(0.0005);

    // Verify X-Payment header was sent on retry (call index shifted by attestation)
    const retryCall = vi.mocked(fetch).mock.calls[3];
    const retryHeaders = new Headers((retryCall[1]?.headers ?? {}) as HeadersInit);
    expect(retryHeaders.get('x-payment')).toBeTruthy();
  });

  it('no wallet: 402 throws without attempting payment', async () => {
    const gw = new MCPGateway({ url: BASE });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Payment required'),
      } as Response);

    await gw.authenticate();
    await expect(gw.callTool('server-1', 'search', {})).rejects.toThrow('Tool call failed: 402');
  });

  it('backward compat: old wallet config creates SpendingWallet', async () => {
    const gw = new MCPGateway({
      url: BASE,
      wallet: { privateKey: MOCK_KEY },
      payment: { maxPerCall: '0.01', maxDaily: '5.00' },
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt' }),
      } as Response);

    await gw.authenticate();

    // The internal wallet should have been created
    expect(gw.wallet).toBeDefined();
    expect(gw.wallet!.address).toMatch(/^0x/);
  });

  it('spending wallet exposes wallet property', async () => {
    const wallet = await SpendingWallet.fromPrivateKey(MOCK_KEY);
    const gw = new MCPGateway({ url: BASE, spendingWallet: wallet });
    expect(gw.wallet).toBe(wallet);
  });
});
