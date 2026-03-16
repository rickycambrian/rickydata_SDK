import type { CachedToken } from './types.js';
import { AuthError, AuthErrorCode } from './errors.js';
import { getToken, setToken, clearToken, isTokenValid } from './token-cache.js';

/**
 * Simplified auth manager providing challenge/verify flow with token caching.
 *
 * This is the shared, dependency-free core. The full AuthManager in
 * `packages/core/src/auth.ts` extends this with ERC-8128, wallet-token,
 * and GitHub OIDC strategies.
 */
export class SharedAuthManager {
  private baseUrl: string;
  private _token: string | null = null;
  private _address: string | null = null;
  private _expiresAt: number | null = null;
  private _signFn: ((message: string) => Promise<string>) | null = null;

  /** Guard against concurrent re-authentication */
  private _reauthPromise: Promise<CachedToken> | null = null;

  constructor(baseUrl: string, existingToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (existingToken) this._token = existingToken;
  }

  /** Try to restore a session from cached token storage. */
  restoreFromCache(): CachedToken | null {
    const cached = getToken();
    if (cached && isTokenValid(cached)) {
      this._token = cached.token;
      this._address = cached.address;
      this._expiresAt = cached.expiresAt;
      return cached;
    }
    return null;
  }

  get isAuthenticated(): boolean {
    return this._token !== null;
  }

  get isExpired(): boolean {
    if (!this._expiresAt) return false;
    return Date.now() >= this._expiresAt - 60_000; // 60s safety margin
  }

  get canReauthenticate(): boolean {
    return this._signFn !== null && this._address !== null;
  }

  get token(): string | null {
    return this._token;
  }

  get address(): string | null {
    return this._address;
  }

  getAuthHeaders(): Record<string, string> {
    return this._token ? { Authorization: `Bearer ${this._token}` } : {};
  }

  /**
   * Authenticate via challenge/verify signature flow.
   *
   * 1. GET /api/auth/challenge → { nonce, message }
   * 2. Sign message with wallet
   * 3. POST /api/auth/verify → { token, expiresAt }
   */
  async authenticate(
    walletAddress: string,
    signFn: (message: string) => Promise<string>,
  ): Promise<CachedToken> {
    this._signFn = signFn;
    this._address = walletAddress;

    // 1. Get challenge
    const challengeRes = await fetch(`${this.baseUrl}/api/auth/challenge`);
    if (!challengeRes.ok) {
      throw new AuthError(
        AuthErrorCode.CHALLENGE_EXPIRED,
        `Challenge request failed: ${challengeRes.status}`,
      );
    }
    const { nonce, message } = await challengeRes.json();

    // 2. Sign the challenge
    const signature = await signFn(message);

    // 3. Verify
    const verifyRes = await fetch(`${this.baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, signature, nonce }),
    });

    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      throw new AuthError(
        AuthErrorCode.SIGNATURE_INVALID,
        `Verify failed: ${verifyRes.status} ${body}`,
      );
    }

    const data = await verifyRes.json();
    this._token = data.token;
    this._expiresAt = this.parseExpiresAt(data.expiresAt);

    const cached: CachedToken = {
      token: data.token,
      address: walletAddress,
      expiresAt: this._expiresAt ?? 0,
      storedAt: Date.now(),
    };
    setToken(cached);

    return cached;
  }

  /**
   * Re-authenticate using previously stored credentials.
   * Safe to call concurrently — deduplicates into a single auth request.
   */
  async reauthenticate(): Promise<CachedToken> {
    if (!this._signFn || !this._address) {
      throw new AuthError(
        AuthErrorCode.NO_IDENTITY_FOUND,
        'Cannot re-authenticate: no previous credentials stored. Call authenticate() first.',
      );
    }

    // Deduplicate concurrent re-auth calls
    if (this._reauthPromise) return this._reauthPromise;

    this._reauthPromise = (async () => {
      try {
        return await this.authenticate(this._address!, this._signFn!);
      } finally {
        this._reauthPromise = null;
      }
    })();

    return this._reauthPromise;
  }

  /** Clear the current session and all cached tokens. */
  logout(): void {
    this._token = null;
    this._address = null;
    this._expiresAt = null;
    this._signFn = null;
    clearToken();
  }

  private parseExpiresAt(expiresAt: unknown): number | null {
    if (typeof expiresAt === 'number') return expiresAt;
    if (typeof expiresAt === 'string' && expiresAt) {
      const ms = Date.parse(expiresAt);
      return isNaN(ms) ? null : ms;
    }
    return null;
  }
}
