import type {
  AutoDeriveOptions,
  DeriveChallenge,
  DeriveKeyResult,
  DeriveSessionStore,
  KfdbBatchGetEntitiesRequest,
  KfdbBatchGetEntitiesResponse,
  KfdbClientConfig,
  KfdbEntityResponse,
  KfdbFilterEntitiesRequest,
  KfdbGetEntityOptions,
  KfdbListEntitiesOptions,
  KfdbListEntitiesResponse,
  KfdbListLabelsResponse,
  KfdbQueryScope,
  KfdbWriteRequest,
  KfdbWriteResponse,
} from './types.js';
import { deriveKeyFromSignature, encryptProperties, decryptResponseRows } from '../encryption.js';
import { buildAgentChatTraceOperations, type AgentChatTurnTrace } from './agent-chat-trace.js';
import { buildClaudeCodeHookTraceOperations, type ClaudeCodeHookTrace } from './claude-code-hook-trace.js';
import { buildCodexHookTraceOperations, type CodexHookTrace } from './codex-hook-trace.js';

function normalizeKfdbExpiresAt(raw: number): number {
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

export class KFDBClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly apiKey?: string;
  private readonly defaultReadScope: KfdbQueryScope;
  private readonly encryptionKey?: CryptoKey;
  private readonly walletAddress?: string;
  private deriveSessionId: string | null = null;
  private deriveKeyHex: string | null = null;
  private deriveExpiresAt: number | null = null;

  // Auto-derive state
  private deriveSignFn: ((typedData: Record<string, unknown>) => Promise<string>) | null = null;
  private deriveStore: DeriveSessionStore | null = null;
  private deriveRefreshMarginMs = 60_000;
  private derivePromise: Promise<void> | null = null;

  constructor(config: KfdbClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.apiKey = config.apiKey;
    this.defaultReadScope = config.defaultReadScope ?? 'global';
    this.encryptionKey = config.encryptionKey;
    this.walletAddress = config.walletAddress;

    if (!this.token && !this.apiKey) {
      throw new Error('KFDBClient requires either token or apiKey');
    }
  }

  /**
   * One-call sign-to-derive setup.
   *
   * Orchestrates the full S2D flow against the KFDB derive endpoints:
   * 1. Check session store cache (if provided) — hot path: 0 HTTP calls
   * 2. GET /api/v1/auth/derive-challenge → { challenge_id, typed_data }
   * 3. Sign EIP-712 typed data via the provided signFn
   * 4. POST /api/v1/auth/derive-key → { session_id, expires_at }
   * 5. Derive key locally: SHA-256(signature_bytes)
   * 6. Store session and enable auto-refresh on expiry
   *
   * After calling autoDerive(), all subsequent requests automatically
   * include S2D headers. When the session approaches expiry, the next
   * request re-derives transparently.
   *
   * @param signTypedData - Signs EIP-712 typed data, returns hex signature
   * @param options - Optional session store for caching + refresh margin
   *
   * @example
   * ```ts
   * const kfdb = new KFDBClient({ baseUrl, apiKey, walletAddress });
   * await kfdb.autoDerive(
   *   (typedData) => wallet.signTypedData(typedData),
   *   { sessionStore: new FileDeriveSessionStore('~/.rickydata/derive-session.json') },
   * );
   * // All reads/writes now use user-controlled encryption
   * ```
   */
  async autoDerive(
    signTypedData: (typedData: Record<string, unknown>) => Promise<string>,
    options?: AutoDeriveOptions,
  ): Promise<void> {
    if (!this.walletAddress) {
      throw new Error('autoDerive requires walletAddress in KfdbClientConfig');
    }

    this.deriveSignFn = signTypedData;
    this.deriveStore = options?.sessionStore ?? null;
    this.deriveRefreshMarginMs = options?.refreshMarginMs ?? 60_000;

    // Try cached session first
    if (this.deriveStore) {
      const cached = await this.deriveStore.get(this.walletAddress);
      if (cached && Date.now() < cached.expiresAt - this.deriveRefreshMarginMs) {
        this.deriveSessionId = cached.sessionId;
        this.deriveKeyHex = cached.keyHex;
        this.deriveExpiresAt = cached.expiresAt;
        return;
      }
    }

    await this.performDerive();
  }

  /**
   * Set derive session credentials for user-controlled encryption.
   * When set, X-Derive-Session-Id and X-Derive-Key headers are sent
   * with all subsequent requests, enabling server-side user-key decryption.
   */
  setDeriveSession(sessionId: string, derivedKeyHex: string): void {
    this.deriveSessionId = sessionId;
    this.deriveKeyHex = derivedKeyHex;
  }

  /**
   * Clear derive session credentials.
   * Subsequent requests will not include derive session headers.
   */
  clearDeriveSession(): void {
    this.deriveSessionId = null;
    this.deriveKeyHex = null;
    this.deriveExpiresAt = null;
    this.deriveSignFn = null;
    this.deriveStore = null;
  }

  withScope(scope: KfdbQueryScope): KFDBClient {
    return new KFDBClient({
      baseUrl: this.baseUrl,
      token: this.token,
      apiKey: this.apiKey,
      defaultReadScope: scope,
      encryptionKey: this.encryptionKey,
      walletAddress: this.walletAddress,
    });
  }

  async listLabels(scope?: KfdbQueryScope): Promise<KfdbListLabelsResponse> {
    const resolvedScope = this.resolveScope(scope);
    const res = await this.request(`/api/v1/entities/labels?scope=${resolvedScope}`);
    return this.parseJson<KfdbListLabelsResponse>(res, 'list labels');
  }

  async listEntities(label: string, options: KfdbListEntitiesOptions = {}): Promise<KfdbListEntitiesResponse> {
    const params = new URLSearchParams();
    params.set('scope', this.resolveScope(options.scope));
    if (options.limit != null) params.set('limit', String(options.limit));
    if (options.offset != null) params.set('offset', String(options.offset));
    if (options.sortBy) params.set('sort_by', options.sortBy);
    if (options.sortOrder) params.set('sort_order', options.sortOrder);
    if (options.includeEmbeddings != null) params.set('include_embeddings', String(options.includeEmbeddings));

    const encodedLabel = encodeURIComponent(label);
    const res = await this.request(`/api/v1/entities/${encodedLabel}?${params.toString()}`);
    const data = await this.parseJson<KfdbListEntitiesResponse>(res, 'list entities');
    if (this.encryptionKey && data.items.length > 0) {
      data.items = await decryptResponseRows(this.encryptionKey, data.items);
    }
    return data;
  }

  async getEntity(label: string, id: string, options: KfdbGetEntityOptions = {}): Promise<KfdbEntityResponse> {
    const params = new URLSearchParams();
    params.set('scope', this.resolveScope(options.scope));
    if (options.includeEmbeddings != null) params.set('include_embeddings', String(options.includeEmbeddings));

    const encodedLabel = encodeURIComponent(label);
    const encodedId = encodeURIComponent(id);
    const res = await this.request(`/api/v1/entities/${encodedLabel}/${encodedId}?${params.toString()}`);
    const data = await this.parseJson<KfdbEntityResponse>(res, 'get entity');
    if (this.encryptionKey) {
      const [decrypted] = await decryptResponseRows(this.encryptionKey, [data.properties]);
      data.properties = decrypted;
    }
    return data;
  }

  async filterEntities(label: string, request: KfdbFilterEntitiesRequest): Promise<KfdbListEntitiesResponse> {
    const encodedLabel = encodeURIComponent(label);
    const payload = {
      scope: this.resolveScope(request.scope),
      filters: request.filters ?? {},
      limit: request.limit,
      offset: request.offset,
      sort_by: request.sortBy,
      sort_order: request.sortOrder,
      include_embeddings: request.includeEmbeddings,
    };

    const res = await this.request(`/api/v1/entities/${encodedLabel}/filter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await this.parseJson<KfdbListEntitiesResponse>(res, 'filter entities');
    if (this.encryptionKey && data.items.length > 0) {
      data.items = await decryptResponseRows(this.encryptionKey, data.items);
    }
    return data;
  }

  async batchGetEntities(request: KfdbBatchGetEntitiesRequest): Promise<KfdbBatchGetEntitiesResponse> {
    const payload = {
      scope: this.resolveScope(request.scope),
      entities: request.entities,
      include_embeddings: request.includeEmbeddings,
    };

    const res = await this.request('/api/v1/entities/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await this.parseJson<KfdbBatchGetEntitiesResponse>(res, 'batch get entities');
    if (this.encryptionKey) {
      const entries = Object.entries(data.entities);
      if (entries.length > 0) {
        const props = entries.map(([, v]) => v);
        const decrypted = await decryptResponseRows(this.encryptionKey, props);
        for (let i = 0; i < entries.length; i++) {
          data.entities[entries[i][0]] = decrypted[i];
        }
      }
    }
    return data;
  }

  async write(request: KfdbWriteRequest): Promise<KfdbWriteResponse> {
    if (this.walletAddress && !this.deriveSessionId) {
      throw new Error(
        'Sign-to-derive session required for writes when walletAddress is configured. ' +
        'Call setDeriveSession() before writing data.',
      );
    }
    let payload = request;
    if (this.encryptionKey) {
      const encryptedOps = await Promise.all(
        request.operations.map(async (op) => {
          if (op.properties && typeof op.properties === 'object') {
            return {
              ...op,
              properties: await encryptProperties(
                this.encryptionKey!,
                op.properties as Record<string, unknown>,
              ),
            };
          }
          return op;
        }),
      );
      payload = { ...request, operations: encryptedOps };
    }
    const res = await this.request('/api/v1/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return this.parseJson<KfdbWriteResponse>(res, 'write');
  }

  async writeAgentChatTrace(trace: AgentChatTurnTrace): Promise<KfdbWriteResponse> {
    return this.write({
      operations: buildAgentChatTraceOperations(trace),
      skip_embedding: true,
    });
  }

  async writeCodexHookTrace(trace: CodexHookTrace): Promise<KfdbWriteResponse> {
    return this.write({
      operations: buildCodexHookTraceOperations(trace),
      skip_embedding: true,
    });
  }

  async writeClaudeCodeHookTrace(trace: ClaudeCodeHookTrace): Promise<KfdbWriteResponse> {
    return this.write({
      operations: buildClaudeCodeHookTraceOperations(trace),
      skip_embedding: true,
    });
  }

  private resolveScope(scope?: KfdbQueryScope): KfdbQueryScope {
    return scope ?? this.defaultReadScope;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    // Auto-refresh derive session if approaching expiry
    await this.ensureDeriveSession();

    const token = this.token ?? this.apiKey;
    if (!token) {
      throw new Error('No auth token available for KFDB request');
    }

    const headers = new Headers(init?.headers ?? {});
    headers.set('Authorization', `Bearer ${token}`);

    if (this.walletAddress) {
      headers.set('X-Wallet-Address', this.walletAddress);
    }

    if (this.deriveSessionId && this.deriveKeyHex) {
      headers.set('X-Derive-Session-Id', this.deriveSessionId);
      headers.set('X-Derive-Key', this.deriveKeyHex);
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  /** Re-derive if session is near expiry and autoDerive was configured. */
  private async ensureDeriveSession(): Promise<void> {
    if (!this.deriveSignFn || !this.deriveExpiresAt) return;
    if (Date.now() < this.deriveExpiresAt - this.deriveRefreshMarginMs) return;

    // Deduplicate concurrent refreshes
    if (!this.derivePromise) {
      this.derivePromise = this.performDerive().finally(() => {
        this.derivePromise = null;
      });
    }
    return this.derivePromise;
  }

  /** Execute the full challenge → sign → derive-key → local-hash flow. */
  private async performDerive(): Promise<void> {
    if (!this.walletAddress || !this.deriveSignFn) {
      throw new Error('autoDerive not configured');
    }

    const token = this.token ?? this.apiKey;
    if (!token) {
      throw new Error('No auth token available for derive challenge');
    }

    // 1. Fetch challenge
    const challengeRes = await fetch(`${this.baseUrl}/api/v1/auth/derive-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    });
    if (!challengeRes.ok) {
      const body = await challengeRes.text().catch(() => '');
      throw new Error(`Derive challenge failed: ${challengeRes.status} ${body}`);
    }
    const challenge: DeriveChallenge = await challengeRes.json();

    // 2. Sign EIP-712 typed data
    const signature = await this.deriveSignFn(challenge.typed_data);

    // 3. Exchange for session
    const deriveRes = await fetch(`${this.baseUrl}/api/v1/auth/derive-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        signature,
        address: this.walletAddress,
      }),
    });
    if (!deriveRes.ok) {
      const body = await deriveRes.text().catch(() => '');
      throw new Error(`Derive key exchange failed: ${deriveRes.status} ${body}`);
    }
    const result: DeriveKeyResult = await deriveRes.json();

    // 4. Derive key locally — SHA-256(signature_bytes)
    const keyHex = result.key_hex ?? deriveKeyFromSignature(signature);

    // 5. Store session
    this.deriveSessionId = result.session_id;
    this.deriveKeyHex = keyHex;
    const expiresAt = normalizeKfdbExpiresAt(result.expires_at);
    this.deriveExpiresAt = expiresAt;

    // 6. Persist to store if configured
    if (this.deriveStore) {
      await this.deriveStore.set(this.walletAddress, {
        sessionId: result.session_id,
        keyHex,
        expiresAt,
        address: this.walletAddress,
      });
    }
  }

  private async parseJson<T>(res: Response, action: string): Promise<T> {
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`Failed to ${action}: ${res.status}${errorBody ? ` ${errorBody}` : ''}`);
    }
    return res.json() as Promise<T>;
  }
}
