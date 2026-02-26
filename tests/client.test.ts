import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPGateway } from '../src/client.js';

const BASE = 'http://localhost:8080';

describe('MCPGateway', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a client with config', () => {
    const gw = new MCPGateway({ url: BASE });
    expect(gw).toBeDefined();
  });

  it('strips trailing slash from URL', () => {
    const gw = new MCPGateway({ url: BASE + '/' });
    expect(gw).toBeDefined();
  });

  it('authenticates and calls tools', async () => {
    // Mock auth
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt', expiresAt: '2099-01-01' }),
      } as Response)
      // Mock listTools
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ tools: [{ name: 'search', description: 'Search' }] }),
      } as Response)
      // Mock callTool
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ content: 'found it', isError: false }),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();

    const tools = await gw.listTools('server-1');
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('search');

    const result = await gw.callTool('server-1', 'search', { query: 'test' });
    expect(result.content).toBe('found it');
  });

  it('stores and retrieves secrets', async () => {
    vi.spyOn(globalThis, 'fetch')
      // Auth
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt' }),
      } as Response)
      // Store secrets
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
      // Get secrets
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ keys: ['API_KEY'] }),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    await gw.storeSecrets('server-1', { API_KEY: 'sk-123' });
    const keys = await gw.getSecrets('server-1');
    expect(keys).toEqual(['API_KEY']);
  });

  it('lists servers', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ servers: [{ id: '1', name: 'test-server' }] }),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    const servers = await gw.listServers({ registry: 'npm' });
    expect(servers).toHaveLength(1);

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(call[0]).toContain('registry=npm');
  });

  it('gets payment config', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ token: 'jwt' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ enabled: true, network: 'base', pricePerCall: '0.01' }),
      } as Response);

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticate();
    const config = await gw.getPaymentConfig();
    expect(config.enabled).toBe(true);
  });

  it('tracks spending', () => {
    const gw = new MCPGateway({ url: BASE });
    const spending = gw.getSpending();
    expect(spending.totalSpent).toBe(0);
    expect(spending.callCount).toBe(0);
  });

  it('authenticates with wallet token', async () => {
    vi.spyOn(globalThis, 'fetch')
      // GET /api/auth/token-message
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'MCP Gateway Auth\nWallet: 0xAddr\nExpires: 2027-01-01T00:00:00Z' }),
      } as Response)
      // POST /api/auth/create-token
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          token: 'mcpwt_client_test',
          walletAddress: '0xAddr',
          expiresAt: '2027-01-01T00:00:00Z',
        }),
      } as Response)
      // listServers
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ servers: [{ id: '1', name: 'test' }] }),
      } as Response);

    const signFn = vi.fn().mockResolvedValue('0xsig');
    const gw = new MCPGateway({ url: BASE });
    const session = await gw.authenticateWithWalletToken(signFn, '0xAddr', '2027-01-01T00:00:00Z');

    expect(session.token).toBe('mcpwt_client_test');

    // Verify token is used in subsequent calls
    const servers = await gw.listServers();
    expect(servers).toHaveLength(1);

    const serverCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[2];
    const serverHeaders = new Headers((serverCall[1]?.headers ?? {}) as HeadersInit);
    expect(serverHeaders.get('authorization')).toBe('Bearer mcpwt_client_test');
  });

  it('authenticates with authenticateAuto (wallet-token first)', async () => {
    vi.spyOn(globalThis, 'fetch')
      // GET /api/auth/token-message
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'MCP Gateway Auth\nWallet: 0xAddr\nExpires: 2027-01-01T00:00:00Z' }),
      } as Response)
      // POST /api/auth/create-token
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          token: 'mcpwt_auto_client_test',
          walletAddress: '0xAddr',
          expiresAt: '2027-01-01T00:00:00Z',
        }),
      } as Response);

    const signFn = vi.fn().mockResolvedValue('0xsig');
    const gw = new MCPGateway({ url: BASE });
    const session = await gw.authenticateAuto({
      signFn,
      walletAddress: '0xAddr',
      walletTokenExpiresAt: '2027-01-01T00:00:00Z',
    });

    expect(session?.token).toBe('mcpwt_auto_client_test');
  });

  it('authenticates with ERC-8128 mode and sends signed requests without bearer token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ servers: [{ id: '1', name: 'signed' }] }),
      text: () => Promise.resolve('{\"servers\":[]}'),
    } as Response);

    const signer = {
      address: '0x0000000000000000000000000000000000000001' as const,
      chainId: 8453,
      signMessage: vi.fn().mockResolvedValue('0x1234' as const),
    };

    const gw = new MCPGateway({ url: BASE });
    await gw.authenticateWithErc8128(signer);
    const servers = await gw.listServers();

    expect(servers).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [requestLike, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = requestLike instanceof Request
      ? requestLike.headers
      : new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('signature')).toBeTruthy();
    expect(headers.get('signature-input')).toBeTruthy();
  });
});
