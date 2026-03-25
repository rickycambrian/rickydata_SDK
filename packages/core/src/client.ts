import type {
  GatewayConfig,
  AttestationResult,
  AuthSession,
  Server,
  ServerDetail,
  Tool,
  ToolResult,
  PaymentConfig,
  SpendingSummary,
  ListOptions,
  RuntimeScope,
  SemanticSearchOptions,
  SemanticSearchResult,
} from './types/index.js';
import { AuthManager, type AuthenticateAutoOptions, type EthHttpSigner } from './auth.js';
import { SecretsManager } from './secrets.js';
import { ToolsManager } from './tools.js';
import { SpendingWallet } from './wallet/spending-wallet.js';

const DEFAULT_TEE_BASE_URL = 'https://tee.knowledgedataflow.org';

export class MCPGateway {
  private auth: AuthManager;
  private secrets: SecretsManager;
  private tools: ToolsManager;
  private baseUrl: string;
  private _wallet: SpendingWallet | null = null;
  private _teeMode: boolean;
  private _teeBaseUrl: string;
  private _attestationVerified = false;
  private _attestationPromise: Promise<void> | null = null;

  constructor(config: GatewayConfig) {
    this._teeMode = config.teeMode ?? !!(config.spendingWallet || config.wallet?.privateKey);
    this._teeBaseUrl = (config.teeBaseUrl ?? DEFAULT_TEE_BASE_URL).replace(/\/$/, '');

    // When teeMode is enabled, use the TEE endpoint as base URL
    this.baseUrl = this._teeMode
      ? this._teeBaseUrl
      : config.url.replace(/\/$/, '');

    // Warn if teeMode is enabled without wallet auth
    if (this._teeMode && !config.spendingWallet && !config.wallet?.privateKey) {
      console.warn(
        '[SDK] teeMode is enabled without wallet auth (spendingWallet or wallet.privateKey). ' +
        'API-key-only auth will not produce encrypted data in TEE mode. ' +
        'Configure a SpendingWallet or privateKey for full TEE protection.',
      );
    }

    this.auth = new AuthManager(this.baseUrl, config.auth?.token);
    this.auth.setRuntimeScopeId(config.auth?.runtimeScopeId);
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

  /**
   * Verify TEE attestation once per session when teeMode is active.
   * Called automatically before the first request. Safe to call concurrently.
   */
  private async _ensureAttestationVerified(): Promise<void> {
    if (!this._teeMode || this._attestationVerified) return;

    // Deduplicate concurrent calls
    if (this._attestationPromise) {
      await this._attestationPromise;
      return;
    }

    this._attestationPromise = (async () => {
      const result = await this.verifyAttestation();
      if (!result.verified) {
        throw new Error(
          `TEE attestation failed: platform=${result.platform}, ` +
          `encryptionEnabled=${result.encryptionEnabled}. Data may not be protected.`,
        );
      }
      this._attestationVerified = true;
    })();

    try {
      await this._attestationPromise;
    } finally {
      this._attestationPromise = null;
    }
  }

  // Auth
  async authenticate(signFn?: (message: string) => Promise<string>, address?: string): Promise<AuthSession> {
    // Auto-init legacy wallet if needed
    await this.ensureWallet();
    return this.auth.authenticate(signFn, address);
  }

  setRuntimeScopeId(runtimeScopeId?: string | null): void {
    this.auth.setRuntimeScopeId(runtimeScopeId);
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
    await this._ensureAttestationVerified();
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

  /**
   * Semantic search for MCP servers and agents using AI embeddings.
   * Requires wallet authentication.
   */
  async semanticSearch(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult> {
    const body: Record<string, unknown> = { query };
    if (options?.limit != null) body.limit = options.limit;
    if (options?.includeAgents != null) body.includeAgents = options.includeAgents;
    if (options?.category) body.category = options.category;
    if (options?.type) body.type = options.type;

    const res = await this.authenticatedFetch(`${this.baseUrl}/api/catalog/semantic-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Semantic search failed: ${res.status}${text ? ` — ${text}` : ''}`);
    }
    return res.json();
  }

  async listRuntimeScopes(externalRef?: string): Promise<RuntimeScope[]> {
    const qs = externalRef ? `?externalRef=${encodeURIComponent(externalRef)}` : '';
    const res = await this.authenticatedFetch(`${this.baseUrl}/wallet/runtime-scopes${qs}`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Failed to list runtime scopes: ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.scopes)) return data.scopes;
    if (data.scope) return [data.scope];
    return [];
  }

  async createRuntimeScope(input: {
    name: string;
    externalRef?: string | null;
    metadata?: Record<string, unknown>;
    budgetMicrousd?: number;
  }): Promise<RuntimeScope> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/wallet/runtime-scopes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Failed to create runtime scope: ${res.status}`);
    return res.json();
  }

  async getRuntimeScope(scopeId: string): Promise<RuntimeScope> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/wallet/runtime-scopes/${encodeURIComponent(scopeId)}`);
    if (!res.ok) throw new Error(`Failed to get runtime scope: ${res.status}`);
    return res.json();
  }

  async updateRuntimeScope(scopeId: string, patch: Record<string, unknown>): Promise<RuntimeScope> {
    const res = await this.authenticatedFetch(`${this.baseUrl}/wallet/runtime-scopes/${encodeURIComponent(scopeId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`Failed to update runtime scope: ${res.status}`);
    return res.json();
  }

  async enableServerForRuntimeScope(scopeId: string, serverId: string): Promise<string[]> {
    const res = await this.authenticatedFetch(
      `${this.baseUrl}/wallet/runtime-scopes/${encodeURIComponent(scopeId)}/servers/${encodeURIComponent(serverId)}/enable`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(`Failed to enable server for runtime scope: ${res.status}`);
    const data = await res.json();
    return data.enabledServerIds ?? [];
  }

  async disableServerForRuntimeScope(scopeId: string, serverId: string): Promise<string[]> {
    const res = await this.authenticatedFetch(
      `${this.baseUrl}/wallet/runtime-scopes/${encodeURIComponent(scopeId)}/servers/${encodeURIComponent(serverId)}/disable`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(`Failed to disable server for runtime scope: ${res.status}`);
    const data = await res.json();
    return data.enabledServerIds ?? [];
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
    await this._ensureAttestationVerified();
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

  /** Whether TEE private mode is currently active */
  get teeMode(): boolean {
    return this._teeMode;
  }

  /**
   * Verify TEE attestation by calling the attestation endpoint.
   * Returns structured attestation information including platform,
   * image digest, and whether encryption is enabled.
   */
  async verifyAttestation(): Promise<AttestationResult> {
    const url = `${this._teeBaseUrl}/api/v1/attestation`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`TEE attestation request failed: ${res.status}`);
    }
    const data = await res.json();
    return {
      verified: data.attestation_available === true,
      platform: data.platform ?? 'unknown',
      imageDigest: data.image_digest ?? '',
      encryptionEnabled: data.encryption_enabled === true,
    };
  }

  /**
   * Switch to TEE private mode.
   *
   * Verifies TEE attestation, then reconfigures the client to route
   * all subsequent requests through the TEE-protected endpoint.
   * Throws if attestation verification fails.
   */
  async enablePrivateMode(): Promise<AttestationResult> {
    if (!this._wallet && !this._legacyWalletConfig) {
      throw new Error(
        'TEE private mode requires wallet auth (SpendingWallet or privateKey). ' +
        'API-key-only auth will not produce encrypted data.',
      );
    }

    const attestation = await this.verifyAttestation();
    if (!attestation.verified) {
      throw new Error(
        `TEE attestation failed: platform=${attestation.platform}, ` +
        `encryptionEnabled=${attestation.encryptionEnabled}`,
      );
    }

    // Switch base URL to TEE endpoint
    this._teeMode = true;
    this._attestationVerified = true;
    this.baseUrl = this._teeBaseUrl;

    // Recreate managers with new base URL
    const savedAuth = this.auth.isAuthenticated ? this.auth.getToken() : undefined;
    this.auth = new AuthManager(this.baseUrl, savedAuth);
    this.secrets = new SecretsManager(this.baseUrl, this.auth);
    const autoSign = true;
    this.tools = new ToolsManager(
      this.baseUrl,
      this.auth,
      this._wallet,
      autoSign,
    );

    return attestation;
  }
}
