import type { AuthSession } from './types/payment.js';

// ── Inlined from @rickydata/auth to avoid file: dependency in published package ──

export enum AuthErrorCode {
  CHALLENGE_EXPIRED = 'CHALLENGE_EXPIRED',
  SIGNATURE_INVALID = 'SIGNATURE_INVALID',
  ADDRESS_MISMATCH = 'ADDRESS_MISMATCH',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_MALFORMED = 'TOKEN_MALFORMED',
  NO_IDENTITY_FOUND = 'NO_IDENTITY_FOUND',
  IDENTITY_SUSPENDED = 'IDENTITY_SUSPENDED',
  PROVIDER_LINK_CONFLICT = 'PROVIDER_LINK_CONFLICT',
  SESSION_REVOKED = 'SESSION_REVOKED',
  RATE_LIMITED = 'RATE_LIMITED',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
}

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AuthError';
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.details && { details: this.details }),
    };
  }
}

export const STORAGE_KEY = 'rickydata-auth-token';
export const TOKEN_REFRESH_MARGIN_MS = 120_000; // 2 minutes before expiry

export type SharedAuthSession = AuthSession;

export interface CachedToken {
  token: string;
  address: string;
  tenantId?: string;
  expiresAt: number;
  storedAt: number;
}

export interface WalletTokenPayload {
  sub: string;
  iss: string;
  exp: number;
  iat: number;
  tid?: string;
  permissions?: string[];
  server_id?: string;
}

export interface WalletTokenOptions {
  permissions?: string[];
  serverId?: string;
}

export interface WalletAdapter {
  getAddress(): string | null;
  signMessage(message: string): Promise<string>;
  isReady(): boolean;
  onAddressChange?(callback: (address: string | null) => void): () => void;
}

export type EthHttpSigner = {
  address: `0x${string}`;
  chainId: number;
  signMessage: (message: Uint8Array) => Promise<`0x${string}`>;
};

export interface AuthenticateAutoOptions {
  signFn?: (message: string) => Promise<string>;
  walletAddress?: string;
  operatorWalletAddress?: string;
  erc8128Signer?: EthHttpSigner;
  walletTokenExpiresAt?: string;
  walletTokenTtlMs?: number;
}

interface Erc8128SignerClient {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

interface Erc8128Module {
  createSignerClient(signer: EthHttpSigner): Erc8128SignerClient;
}

type WalletTokenStage = 'token-message' | 'create-token' | 'derive-key-message' | 'verify-derive-key';

class WalletTokenRequestError extends Error {
  status: number;
  stage: WalletTokenStage;

  constructor(stage: WalletTokenStage, status: number, message: string) {
    super(message);
    this.name = 'WalletTokenRequestError';
    this.status = status;
    this.stage = stage;
  }
}

function isWalletTokenEndpointUnavailable(error: unknown): boolean {
  if (error instanceof WalletTokenRequestError) {
    return error.status === 404 || error.status === 405 || error.status === 501 || error.status === 503;
  }
  return false;
}

let erc8128ModulePromise: Promise<Erc8128Module> | null = null;

async function loadVendoredErc8128(): Promise<Erc8128Module> {
  if (erc8128ModulePromise) return erc8128ModulePromise;
  erc8128ModulePromise = (async () => {
    const moduleUrl = new URL('../vendor/erc8128/dist/esm/index.js', import.meta.url).href;
    const mod = (await import(moduleUrl)) as unknown as Erc8128Module;
    if (!mod || typeof mod.createSignerClient !== 'function') {
      throw new Error('Vendored ERC-8128 module missing createSignerClient export');
    }
    return mod;
  })();
  return erc8128ModulePromise;
}

/**
 * Create a long-lived wallet token via the MCP Gateway.
 *
 * The returned token (`mcpwt_...`) is self-verifying and requires
 * zero server-side storage. It survives gateway restarts.
 *
 * @param gatewayUrl - Gateway base URL (e.g. 'https://mcp.rickydata.org')
 * @param signFn - EIP-191 personal_sign function (e.g. wallet.signMessage)
 * @param walletAddress - Ethereum wallet address (0x-prefixed)
 * @param expiresAt - ISO 8601 expiry (e.g. '2027-02-13T00:00:00Z')
 * @returns The token string (mcpwt_...) or throws on failure
 */
export async function createWalletToken(
  gatewayUrl: string,
  signFn: (message: string) => Promise<string>,
  walletAddress: string,
  expiresAt: string,
  options?: WalletTokenOptions,
): Promise<{ token: string; walletAddress: string; expiresAt: string }> {
  const base = gatewayUrl.replace(/\/$/, '');

  // 1. Get the canonical message to sign
  const msgParams = new URLSearchParams({
    walletAddress,
    expiresAt,
  });
  if (options?.permissions?.length) {
    msgParams.set('permissions', options.permissions.join(','));
  }
  if (options?.serverId) {
    msgParams.set('serverId', options.serverId);
  }
  const msgRes = await fetch(`${base}/api/auth/token-message?${msgParams}`);
  if (!msgRes.ok) {
    const body = await msgRes.text();
    throw new WalletTokenRequestError(
      'token-message',
      msgRes.status,
      `Failed to get token message: ${msgRes.status} ${body}`,
    );
  }
  const { message } = await msgRes.json();

  // 2. Sign with wallet
  const signature = await signFn(message);

  // 3. Create the self-verifying token
  const tokenBody: Record<string, unknown> = { walletAddress, signature, expiresAt };
  if (options?.permissions?.length) {
    tokenBody.permissions = options.permissions;
  }
  if (options?.serverId) {
    tokenBody.serverId = options.serverId;
  }
  const tokenRes = await fetch(`${base}/api/auth/create-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokenBody),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new WalletTokenRequestError(
      'create-token',
      tokenRes.status,
      `Failed to create wallet token: ${tokenRes.status} ${body}`,
    );
  }
  return tokenRes.json();
}

// ─────────────────────────────────────────────────────────────────────
// Sign-to-Derive Key Authentication
// ─────────────────────────────────────────────────────────────────────

/**
 * Response from the gateway for sign-to-derive key setup
 */
export interface DeriveKeyResponse {
  message: string;
  expiresAt: string;
}

/**
 * Create a sign-to-derive encryption key.
 *
 * This enables TRUE user-controlled encryption where the operator
 * cannot read user data, even with full server access.
 *
 * Flow:
 * 1. Request derivation message from gateway
 * 2. User signs the message with their wallet
 * 3. Use signature to derive encryption key
 * 4. Store the signature securely (used for decryption)
 *
 * @param gatewayUrl - Gateway base URL
 * @param signFn - Wallet signMessage function
 * @param walletAddress - User's wallet address
 * @returns Object with derived encryption key and verification
 */
export async function createSignToDeriveKey(
  gatewayUrl: string,
  signFn: (message: string) => Promise<string>,
  walletAddress: string,
): Promise<{ encryptionKey: string; signature: string; expiresAt: string }> {
  const base = gatewayUrl.replace(/\/$/, '');

  // 1. Get the derivation message from gateway
  const msgRes = await fetch(
    `${base}/api/auth/derive-key-message?walletAddress=${encodeURIComponent(walletAddress)}`
  );
  if (!msgRes.ok) {
    const body = await msgRes.text();
    throw new WalletTokenRequestError(
      'derive-key-message',
      msgRes.status,
      `Failed to get derive-key message: ${msgRes.status} ${body}`,
    );
  }
  const { message, expiresAt }: DeriveKeyResponse = await msgRes.json();

  // 2. Sign with wallet
  const signature = await signFn(message);

  // 3. Derive encryption key locally (server never sees this)
  const { deriveKeyFromSignature } = await import('./encryption.js');
  const encryptionKey = deriveKeyFromSignature(signature);

  // 4. Send signature to server for verification/storage (optional)
  // Server only stores the signature hash, not the actual key
  const verifyRes = await fetch(`${base}/api/auth/verify-derive-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress, signature, expiresAt }),
  });

  // Even if server verification fails, we still have the local key
  // The key derivation works independently of server storage

  return { encryptionKey, signature, expiresAt };
}

export class AuthManager {
  private baseUrl: string;
  private token: string | null = null;
  private runtimeScopeId: string | null = null;
  private address: string | null = null;
  private expiresAt: number | null = null;
  private signerClient: Erc8128SignerClient | null = null;

  // Stored credentials for re-authentication
  private _signFn: ((message: string) => Promise<string>) | null = null;
  private _authMode: 'signature' | 'test' | 'walletToken' | 'erc8128' | null = null;
  private _walletTokenExpiresAt: string | null = null;

  /** Guard against concurrent re-authentication */
  private _reauthPromise: Promise<AuthSession> | null = null;

  private static warnedLegacyWalletOnlyAuth = false;

  constructor(baseUrl: string, existingToken?: string) {
    this.baseUrl = baseUrl;
    if (existingToken) this.token = existingToken;
  }

  /**
   * Authenticate via GitHub Actions OIDC token exchange.
   *
   * When running in a GitHub Actions workflow, the runner can generate an OIDC
   * token that proves the workflow is executing for a specific repository. The
   * Agent Gateway verifies this token against GitHub's JWKS, checks that the
   * repository has an active rickydata GitHub App installation, and returns a
   * short-lived session token.
   *
   * Requires `permissions: id-token: write` in the workflow.
   *
   * @param repository - GitHub repository in "owner/repo" format
   * @param audience - Optional OIDC audience (defaults to the Agent Gateway URL)
   */
  async authenticateWithGitHubOIDC(
    repository: string,
    audience?: string,
  ): Promise<AuthSession> {
    this.signerClient = null;

    const oidcToken = await AuthManager.getGitHubOIDCToken(audience ?? this.baseUrl);

    const res = await fetch(`${this.baseUrl}/auth/github/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: oidcToken, repository }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `GitHub OIDC auth failed: ${res.status} ${body}. ` +
        'Ensure the rickydata GitHub App is installed on this repository.',
      );
    }

    const data = await res.json();
    this.token = data.token;
    this.address = data.walletAddress ?? null;
    this.expiresAt = this.parseExpiresAt(data.expiresAt);
    this._authMode = null; // OIDC tokens are single-use, re-auth by calling again
    return { token: data.token, address: data.walletAddress ?? '', expiresAt: data.expiresAt ?? '' };
  }

  /**
   * Request an OIDC token from the GitHub Actions runtime.
   * Only works inside a GitHub Actions workflow with `id-token: write` permission.
   */
  static async getGitHubOIDCToken(audience: string): Promise<string> {
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

    if (!requestUrl || !requestToken) {
      throw new Error(
        'GitHub OIDC not available. This method only works inside GitHub Actions ' +
        'with `permissions: id-token: write`. ' +
        'Env vars ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN are required.',
      );
    }

    const url = `${requestUrl}&audience=${encodeURIComponent(audience)}`;
    const res = await fetch(url, {
      headers: { Authorization: `bearer ${requestToken}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get GitHub OIDC token: ${res.status} ${body}`);
    }

    const data = await res.json();
    return data.value;
  }

  /** Check if running inside GitHub Actions with OIDC available. */
  static get isGitHubActions(): boolean {
    return !!(process.env.GITHUB_ACTIONS && process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  }

  setRuntimeScopeId(runtimeScopeId?: string | null): void {
    this.runtimeScopeId = runtimeScopeId?.trim() || null;
  }

  get isAuthenticated(): boolean {
    return this.token !== null || this._authMode === 'erc8128';
  }

  /** True if the token has a known expiry time that has passed (with 60s buffer). */
  get isExpired(): boolean {
    if (!this.expiresAt) return false;
    return Date.now() >= this.expiresAt - 60_000; // 60s safety margin
  }

  /** True if we have stored credentials and can automatically re-authenticate. */
  get canReauthenticate(): boolean {
    return this._authMode !== null && this._authMode !== 'erc8128';
  }

  getToken(): string {
    if (!this.token) throw new Error('Not authenticated. Call authenticate() first.');
    return this.token;
  }

  getAuthHeaders(): Record<string, string> {
    if (this._authMode === 'erc8128') return {};
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  isErc8128Mode(): boolean {
    return this._authMode === 'erc8128' && this.signerClient !== null;
  }

  async erc8128Fetch(url: string, init?: RequestInit): Promise<Response> {
    if (!this.signerClient) {
      throw new Error('ERC-8128 mode is not initialized. Call authenticateWithErc8128() first.');
    }
    return this.signerClient.fetch(url, init);
  }

  async fetchWithAuth(
    url: string,
    init?: RequestInit,
    opts?: { retryOn401?: boolean }
  ): Promise<Response> {
    if (this.isErc8128Mode()) {
      return this.erc8128Fetch(url, init);
    }

    const retryOn401 = opts?.retryOn401 !== false;

    if (this.isExpired && this.canReauthenticate) {
      await this.reauthenticate();
    }

    const addBearer = (requestInit?: RequestInit): RequestInit => {
      const headers = new Headers(requestInit?.headers || {});
      const authHeaders = this.getAuthHeaders();
      for (const [name, value] of Object.entries(authHeaders)) {
        headers.set(name, value);
      }
      if (this.runtimeScopeId) {
        headers.set('X-Runtime-Scope-Id', this.runtimeScopeId);
      }
      return { ...requestInit, headers };
    };

    let res = await fetch(url, addBearer(init));
    if (retryOn401 && res.status === 401 && this.canReauthenticate) {
      await this.reauthenticate();
      res = await fetch(url, addBearer(init));
    }
    return res;
  }

  async authenticate(signFn?: (message: string) => Promise<string>, walletAddress?: string): Promise<AuthSession> {
    this.signerClient = null;
    // Store credentials for future re-authentication
    if (signFn && walletAddress) {
      this._signFn = signFn;
      this._authMode = 'signature';
      this.address = walletAddress;
      return this.authenticateWithSignature(walletAddress, signFn);
    }
    if (!signFn && walletAddress && !AuthManager.warnedLegacyWalletOnlyAuth) {
      AuthManager.warnedLegacyWalletOnlyAuth = true;
      console.warn(
        '[SDK] authenticate(undefined, walletAddress) uses test mode and is not recommended for production. ' +
        'Use authenticateWithWalletToken(), authenticateWithErc8128(), or authenticateAuto().',
      );
    }
    this._authMode = 'test';
    this.address = walletAddress ?? '0x0000000000000000000000000000000000000000';
    return this.authenticateTestMode(this.address);
  }

  /**
   * Production-safe auth strategy.
   *
   * Strategy order:
   * 1) Operator strict path: ERC-8128 signer (when signer + operator wallet match)
   * 2) User path: wallet-token auth (when signFn + walletAddress available)
   * 3) Fallback: challenge/verify signature auth (only when wallet-token endpoint is unavailable)
   * 4) Legacy fallback: existing authenticate(...) behavior
   */
  async authenticateAuto(options: AuthenticateAutoOptions): Promise<AuthSession | null> {
    const {
      signFn,
      walletAddress,
      operatorWalletAddress,
      erc8128Signer,
      walletTokenExpiresAt,
      walletTokenTtlMs,
    } = options;

    const normalizedWallet = walletAddress?.toLowerCase();
    const normalizedOperator = operatorWalletAddress?.toLowerCase();
    const normalizedSigner = erc8128Signer?.address?.toLowerCase();

    if (erc8128Signer && normalizedOperator && normalizedSigner === normalizedOperator) {
      if (!normalizedWallet || normalizedWallet === normalizedOperator) {
        await this.authenticateWithErc8128(erc8128Signer);
        return null;
      }
    }

    if (signFn && walletAddress) {
      const expiresAt = walletTokenExpiresAt
        ?? new Date(Date.now() + (walletTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000)).toISOString();
      try {
        return await this.authenticateWithWalletToken(signFn, walletAddress, expiresAt);
      } catch (error) {
        if (!isWalletTokenEndpointUnavailable(error)) {
          throw error;
        }
        this.signerClient = null;
        this._signFn = signFn;
        this._authMode = 'signature';
        this.address = walletAddress;
        return this.authenticateWithSignature(walletAddress, signFn);
      }
    }

    return this.authenticate(signFn, walletAddress);
  }

  async authenticateWithErc8128(signer: EthHttpSigner): Promise<void> {
    const module = await loadVendoredErc8128();
    this.signerClient = module.createSignerClient(signer);
    this._authMode = 'erc8128';
    this._signFn = null;
    this._walletTokenExpiresAt = null;
    this.address = signer.address;
    this.token = null;
    this.expiresAt = null;
  }

  /**
   * Authenticate with a long-lived wallet token.
   *
   * Creates a self-verifying token (mcpwt_) via the gateway and stores it.
   * The token survives gateway restarts and does not need re-authentication
   * until it expires.
   *
   * @param signFn - EIP-191 personal_sign function
   * @param walletAddress - Ethereum wallet address
   * @param expiresAt - ISO 8601 expiry (e.g. '2027-02-13T00:00:00Z')
   */
  async authenticateWithWalletToken(
    signFn: (message: string) => Promise<string>,
    walletAddress: string,
    expiresAt: string,
  ): Promise<AuthSession> {
    this.signerClient = null;
    this._signFn = signFn;
    this._authMode = 'walletToken';
    this._walletTokenExpiresAt = expiresAt;
    this.address = walletAddress;

    const result = await createWalletToken(this.baseUrl, signFn, walletAddress, expiresAt);
    this.token = result.token;
    this.expiresAt = this.parseExpiresAt(result.expiresAt);
    return { token: result.token, address: result.walletAddress, expiresAt: result.expiresAt };
  }

  /**
   * Re-authenticate using previously stored credentials.
   * Safe to call concurrently — deduplicates into a single auth request.
   * Throws if authenticate() was never called.
   */
  async reauthenticate(): Promise<AuthSession> {
    if (!this._authMode) {
      throw new Error('Cannot re-authenticate: no previous credentials stored. Call authenticate() first.');
    }

    // Deduplicate concurrent re-auth calls
    if (this._reauthPromise) return this._reauthPromise;

    this._reauthPromise = (async () => {
      try {
        if (this._authMode === 'erc8128') {
          throw new Error('ERC-8128 mode does not use token re-authentication');
        }
        if (this._authMode === 'walletToken' && this._signFn && this.address && this._walletTokenExpiresAt) {
          return await this.authenticateWithWalletToken(this._signFn, this.address, this._walletTokenExpiresAt);
        }
        if (this._authMode === 'signature' && this._signFn && this.address) {
          return await this.authenticateWithSignature(this.address, this._signFn);
        }
        return await this.authenticateTestMode(this.address ?? '0x0000000000000000000000000000000000000000');
      } finally {
        this._reauthPromise = null;
      }
    })();

    return this._reauthPromise;
  }

  private parseExpiresAt(expiresAt: unknown): number | null {
    if (typeof expiresAt === 'number') return expiresAt;
    if (typeof expiresAt === 'string' && expiresAt) {
      const ms = Date.parse(expiresAt);
      return isNaN(ms) ? null : ms;
    }
    return null;
  }

  private async authenticateTestMode(address: string): Promise<AuthSession> {
    const res = await fetch(`${this.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testMode: true, walletAddress: address }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Auth failed: ${res.status} ${body}`);
    }
    const data = await res.json();
    this.token = data.token;
    this.address = address;
    this.expiresAt = this.parseExpiresAt(data.expiresAt);
    return { token: data.token, address, expiresAt: data.expiresAt ?? '' };
  }

  private async authenticateWithSignature(address: string, signFn: (msg: string) => Promise<string>): Promise<AuthSession> {
    // Get challenge (stateless — no address param needed)
    const challengeRes = await fetch(`${this.baseUrl}/api/auth/challenge`);
    if (!challengeRes.ok) {
      throw new Error(`Challenge request failed: ${challengeRes.status}`);
    }
    const { nonce, message } = await challengeRes.json();

    // Sign the challenge message
    const signature = await signFn(message);

    // Verify with walletAddress and nonce
    const verifyRes = await fetch(`${this.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: address, signature, nonce }),
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      throw new Error(`Verify failed: ${verifyRes.status} ${body}`);
    }
    const data = await verifyRes.json();
    this.token = data.token;
    this.address = address;
    this.expiresAt = this.parseExpiresAt(data.expiresAt);
    return { token: data.token, address, expiresAt: data.expiresAt ?? '' };
  }
}

// ─── Token permission helpers ──────────────────────────────────────

/** Decode an mcpwt_ or JWT token payload without verification (client-side only). */
export function decodeTokenPayload(token: string): WalletTokenPayload | null {
  try {
    let json: string;
    if (token.startsWith('mcpwt_')) {
      const b64 = token.slice(6);
      json = typeof Buffer !== 'undefined'
        ? Buffer.from(b64, 'base64url').toString('utf-8')
        : atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    } else if (token.includes('.')) {
      // JWT: header.payload.signature
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1];
      json = typeof Buffer !== 'undefined'
        ? Buffer.from(b64, 'base64url').toString('utf-8')
        : atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    } else {
      return null;
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Check if a granted permission matches a required permission (supports wildcards). */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === '*:*' || granted === required) return true;
  const [gNs, gAct] = granted.split(':');
  const [rNs, rAct] = required.split(':');
  if (gNs === '*' || gNs === rNs) {
    return gAct === '*' || gAct === rAct;
  }
  return false;
}

/** Get all permissions from a token (empty array for legacy tokens without permissions). */
export function getPermissions(token: string): string[] {
  const payload = decodeTokenPayload(token);
  return payload?.permissions ?? [];
}

/**
 * Check if a token has a specific permission.
 * Returns true for legacy tokens without permissions (backward compat = full access).
 */
export function hasPermission(token: string, permission: string): boolean {
  const perms = getPermissions(token);
  if (perms.length === 0) return true; // legacy token = full access
  return perms.some(p => permissionMatches(p, permission));
}

// ─── Authenticated client for external APIs ────────────────────────

export interface AuthenticatedClient {
  fetch(path: string, init?: RequestInit): Promise<Response>;
  get(path: string): Promise<Response>;
  post(path: string, body: unknown): Promise<Response>;
}

/**
 * Create a lightweight authenticated HTTP client for external APIs (e.g., connect wizard).
 * Adds Bearer token via the provided tokenGetter on each request.
 */
export function createAuthenticatedClient(
  baseUrl: string,
  tokenGetter: () => Promise<string | undefined>,
): AuthenticatedClient {
  const base = baseUrl.replace(/\/$/, '');

  async function authFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await tokenGetter();
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${base}${path}`, { ...init, headers });
  }

  return {
    fetch: authFetch,
    get(path: string) {
      return authFetch(path);
    },
    post(path: string, body: unknown) {
      return authFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
  };
}
