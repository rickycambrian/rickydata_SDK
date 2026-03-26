/**
 * RPC client for the rickydata platform's multi-chain RPC proxy.
 * Proxies JSON-RPC calls through the agent gateway with auth and metering.
 */

export interface ChainInfo {
  chainId: number;
  name: string;
  slug: string;
  explorerUrl?: string;
  testnet: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown[];
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}

export class RpcClient {
  private baseUrl: string;
  private getToken: () => Promise<string | null>;

  constructor(opts: { baseUrl: string; getToken: () => Promise<string | null> }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.getToken = opts.getToken;
  }

  /** Make a JSON-RPC call to the specified chain */
  async call(chainId: number, method: string, params?: unknown[]): Promise<JsonRpcResponse> {
    const token = await this.getToken();
    if (!token) throw new Error('Authentication required for RPC calls');

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params: params ?? [],
      id: Date.now(),
    };

    const res = await fetch(`${this.baseUrl}/api/rpc/${chainId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`RPC proxy error ${res.status}: ${text}`);
    }

    return res.json() as Promise<JsonRpcResponse>;
  }

  /** Get list of supported chains */
  async getChains(): Promise<ChainInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/rpc/chains`);
    if (!res.ok) throw new Error(`Failed to fetch chains: ${res.status}`);
    return res.json() as Promise<ChainInfo[]>;
  }
}
