import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcClient } from '../src/rpc/rpc-client.js';
import type { ChainInfo, JsonRpcResponse } from '../src/rpc/rpc-client.js';

const BASE = 'https://agents.rickydata.org';

describe('RpcClient', () => {
  let client: RpcClient;
  const mockGetToken = vi.fn<() => Promise<string | null>>();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetToken.mockResolvedValue('mcpwt_test_token');
    client = new RpcClient({ baseUrl: BASE, getToken: mockGetToken });
  });

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', async () => {
      const c = new RpcClient({ baseUrl: 'https://example.com/', getToken: mockGetToken });
      const mockResponse: JsonRpcResponse = { jsonrpc: '2.0', result: '0x1', id: 1 };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      await c.call(1, 'eth_chainId');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://example.com/api/rpc/1',
        expect.any(Object),
      );
    });
  });

  describe('call()', () => {
    it('sends correct JSON-RPC format with auth header', async () => {
      const mockResponse: JsonRpcResponse = { jsonrpc: '2.0', result: '0x1', id: 1 };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      const result = await client.call(8453, 'eth_chainId');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${BASE}/api/rpc/8453`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer mcpwt_test_token',
          },
        }),
      );

      // Verify body structure
      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('eth_chainId');
      expect(body.params).toEqual([]);
      expect(typeof body.id).toBe('number');

      expect(result).toEqual(mockResponse);
    });

    it('passes params when provided', async () => {
      const mockResponse: JsonRpcResponse = { jsonrpc: '2.0', result: '0xabc', id: 1 };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );

      await client.call(8453, 'eth_getBalance', ['0x1234', 'latest']);

      const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
      const body = JSON.parse(callArgs[1]!.body as string);
      expect(body.params).toEqual(['0x1234', 'latest']);
    });

    it('throws on missing auth token', async () => {
      mockGetToken.mockResolvedValueOnce(null);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(client.call(8453, 'eth_chainId')).rejects.toThrow(
        'Authentication required for RPC calls',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws on non-200 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(client.call(8453, 'eth_chainId')).rejects.toThrow(
        'RPC proxy error 401: Unauthorized',
      );
    });

    it('returns JSON-RPC error responses without throwing', async () => {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: '2.0',
        error: { code: -32601, message: 'Method not found' },
        id: 1,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(errorResponse), { status: 200 }),
      );

      const result = await client.call(8453, 'eth_nonexistent');
      expect(result.error).toEqual({ code: -32601, message: 'Method not found' });
    });
  });

  describe('getChains()', () => {
    it('returns array of chain info', async () => {
      const chains: ChainInfo[] = [
        { chainId: 8453, name: 'Base', slug: 'base', testnet: false },
        { chainId: 1, name: 'Ethereum', slug: 'ethereum', explorerUrl: 'https://etherscan.io', testnet: false },
      ];
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(chains), { status: 200 }),
      );

      const result = await client.getChains();

      expect(globalThis.fetch).toHaveBeenCalledWith(`${BASE}/api/rpc/chains`);
      expect(result).toEqual(chains);
      expect(result).toHaveLength(2);
    });

    it('does not require auth', async () => {
      mockGetToken.mockResolvedValueOnce(null);
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 }),
      );

      const result = await client.getChains();
      expect(result).toEqual([]);
      // getToken should NOT have been called
      expect(mockGetToken).not.toHaveBeenCalled();
    });

    it('throws on non-200 response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500 }),
      );

      await expect(client.getChains()).rejects.toThrow('Failed to fetch chains: 500');
    });
  });
});
