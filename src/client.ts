import type {
  GatewayConfig,
  AuthSession,
  Server,
  ServerDetail,
  Tool,
  ToolResult,
  PaymentConfig,
  SpendingSummary,
  ListOptions,
} from './types/index.js';
import { AuthManager, type AuthenticateAutoOptions, type EthHttpSigner } from './auth.js';
import { SecretsManager } from './secrets.js';
import { ToolsManager } from './tools.js';
import { SpendingWallet } from './wallet/spending-wallet.js';

export class MCPGateway {
  private auth: AuthManager;
  private secrets: SecretsManager;
  private tools: ToolsManager;
  private baseUrl: string;
  private _wallet: SpendingWallet | null = null;

  constructor(config: GatewayConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.auth = new AuthManager(this.baseUrl, config.auth?.token);
    this.secrets = new SecretsManager(this.baseUrl, this.auth);

    // Wallet resolution: prefer spendingWallet, fall back to legacy privateKey
    if (config.spendingWallet) {
      this._wallet = config.spendingWallet;
    }
    // Legacy wallet config creates a deferred wallet (set up before first use)
    this._legacyWalletConfig = config.wallet?.privateKey ? {
      privateKey: config.wallet.privateKey,
      payment: config.payment,
    } : null;

    const autoSign = config.payment?.autoSign !== false;
    this.tools = new ToolsManager(
      this.baseUrl,
      this.auth,
      this._wallet,
      autoSign,
    );
  }

  private _legacyWalletConfig: {
    privateKey: string;
    payment?: { autoSign?: boolean; maxPerCall?: string; maxDaily?: string };
  } | null = null;

  /** Guards against concurrent ensureWallet() calls */
  private _walletInitPromise: Promise<void> | null = null;

  /**
   * Initialize the legacy wallet if configured but not yet created.
   * Must be called before tool calls when using the old { wallet: { privateKey } } config.
   * Safe to call concurrently — only initializes once.
   */
  async ensureWallet(): Promise<void> {
    if (this._wallet || !this._legacyWalletConfig) return;

    // Deduplicate concurrent calls
    if (this._walletInitPromise) {
      await this._walletInitPromise;
      return;
    }

    this._walletInitPromise = (async () => {
      if (this._wallet || !this._legacyWalletConfig) return;

      const { privateKey, payment } = this._legacyWalletConfig;
      const autoSign = payment?.autoSign !== false;
      this._wallet = await SpendingWallet.fromPrivateKey(privateKey, {
        maxPerCall: parseFloat(payment?.maxPerCall ?? '0') || undefined,
        maxPerDay: parseFloat(payment?.maxDaily ?? '0') || undefined,
      });
      this._legacyWalletConfig = null;

      // Update tools manager with the created wallet
      this.tools = new ToolsManager(
        this.baseUrl,
        this.auth,
        this._wallet,
        autoSign,
      );
    })();

    try {
      await this._walletInitPromise;
    } finally {
      this._walletInitPromise = null;
    }
  }

  // Auth
  async authenticate(signFn?: (message: string) => Promise<string>, address?: string): Promise<AuthSession> {
    // Auto-init legacy wallet if needed
    await this.ensureWallet();
    return this.auth.authenticate(signFn, address);
  }

  async authenticateAuto(options: AuthenticateAutoOptions): Promise<AuthSession | null> {
    await this.ensureWallet();
    return this.auth.authenticateAuto(options);
  }

  async authenticateWithErc8128(signer: EthHttpSigner): Promise<void> {
    await this.ensureWallet();
    return this.auth.authenticateWithErc8128(signer);
  }

  /**
   * Authenticate with a long-lived wallet token (mcpwt_).
   *
   * Creates a self-verifying token via the gateway that survives restarts
   * and requires zero server-side storage.
   *
   * @param signFn - EIP-191 personal_sign function (e.g. wallet.signMessage)
   * @param walletAddress - Ethereum wallet address (0x-prefixed)
   * @param expiresAt - ISO 8601 expiry (e.g. '2027-02-13T00:00:00Z')
   */
  async authenticateWithWalletToken(
    signFn: (message: string) => Promise<string>,
    walletAddress: string,
    expiresAt: string,
  ): Promise<AuthSession> {
    await this.ensureWallet();
    return this.auth.authenticateWithWalletToken(signFn, walletAddress, expiresAt);
  }

  /**
   * Authenticated fetch with automatic 401 re-auth retry.
   * Re-authenticates once if the server returns 401 and credentials are stored.
   */
  private async authenticatedFetch(url: string, init?: RequestInit): Promise<Response> {
    return this.auth.fetchWithAuth(url, init, { retryOn401: true });
  }

  // Discovery
  async listServers(opts?: ListOptions): Promise<Server[]> {
    const params = new URLSearchParams();
    if (opts?.registry) params.set('registry', opts.registry);
    if (opts?.deploymentType) params.set('deploymentType', opts.deploymentType);
    if (opts?.gatewayCompatible !== undefined) params.set('gatewayCompatible', String(opts.gatewayCompatible));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));

    const qs = params.toString();
    const res = await this.authenticatedFetch(`${this.baseUrl}/api/servers${qs ? '?' + qs : ''}`);
    if (!res.ok) throw new Error(`Failed to list servers: ${res.status}`);
    const data = await res.json();
    return data.servers ?? [];
  }

  async getServer(id: string): Promise<ServerDetail> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/api/servers/${id}`);
    if (!res.ok) throw new Error(`Failed to get server: ${res.status}`);
    return res.json();
  }

  async searchServers(query: string): Promise<Server[]> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/api/servers?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const data = await res.json();
    return data.servers ?? [];
  }

  // Secrets
  async storeSecrets(serverId: string, secrets: Record<string, string>): Promise<void> {
    return this.secrets.store(serverId, secrets);
  }

  async getSecrets(serverId: string): Promise<string[]> {
    return this.secrets.get(serverId);
  }

  async deleteSecrets(serverId: string): Promise<void> {
    return this.secrets.delete(serverId);
  }

  // Tools
  async callTool(serverId: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    await this.ensureWallet();
    return this.tools.callTool(serverId, tool, args);
  }

  async listTools(serverId: string): Promise<Tool[]> {
    return this.tools.listTools(serverId);
  }

  // Server lifecycle
  async startServer(serverId: string): Promise<void> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/api/servers/${serverId}/start`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to start server: ${res.status}`);
  }

  async stopServer(serverId: string): Promise<void> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/api/servers/${serverId}/stop`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`Failed to stop server: ${res.status}`);
  }

  // Payment
  async getPaymentConfig(): Promise<PaymentConfig> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/api/payments/config`);
    if (!res.ok) throw new Error(`Failed to get payment config: ${res.status}`);
    return res.json();
  }

  getSpending(): SpendingSummary {
    return this.tools.getSpending();
  }

  /** Get the underlying spending wallet (if configured) */
  get wallet(): SpendingWallet | null {
    return this._wallet;
  }
}
