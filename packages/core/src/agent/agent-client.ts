/**
 * High-level Agent Client
 *
 * Wraps the full Agent Gateway flow (auth, sessions, SSE streaming) into
 * a simple interface for chatting with agents.
 *
 * Uses viem for wallet signing (consistent with the rest of the SDK).
 */

import type { SessionStore as SessionStoreType } from './session-store.js';
import {
  AgentError,
  AgentErrorCode,
} from './types.js';
import type {
  ImageAttachment,
  AgentClientConfig,
  AgentInfo,
  AgentDetailResponse,
  CustomAgentDefinition,
  CustomAgentUpsertResult,
  ChatOptions,
  ChatResult,
  SSEEvent,
  ReflectStatus,
  ReflectConfig,
  KbToolsStatus,
  SessionCreateResponse,
  SessionListEntry,
  SessionDetail,
  McpRequirementsResponse,
  AgentSecretStatus,
  WalletSettings,
  WalletBalanceResponse,
  WalletTransactionsResponse,
  VoiceTokenResponse,
  VoiceLivekitTokenResponse,
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceEndResponse,
  TeamWorkflowPayload,
  TeamSSEEvent,
  TeamWorkflowOptions,
  FreeTierStatus,
  TeamExecutionEngine,
  CodexAuthStatus,
  MarketplaceProvider,
  ProviderApiKeyStatus,
  ProviderVaultUnlockResult,
  WalletSignMessage,
} from './types.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';
const SSE_READ_TIMEOUT_MS = 60_000;

const PROVIDER_CONFIG: Record<MarketplaceProvider, {
  statusPath: string;
  setPath: string;
  bodyKey: string;
  keyPrefix?: string;
}> = {
  anthropic: { statusPath: '/wallet/apikey/status', setPath: '/wallet/apikey', bodyKey: 'anthropicApiKey', keyPrefix: 'sk-ant-' },
  minimax: { statusPath: '/wallet/minimax-apikey/status', setPath: '/wallet/minimax-apikey', bodyKey: 'minimaxApiKey' },
  openrouter: { statusPath: '/wallet/openrouter-apikey/status', setPath: '/wallet/openrouter-apikey', bodyKey: 'openrouterApiKey' },
  zai: { statusPath: '/wallet/zai-apikey/status', setPath: '/wallet/zai-apikey', bodyKey: 'zaiApiKey' },
  deepseek: { statusPath: '/wallet/deepseek-apikey/status', setPath: '/wallet/deepseek-apikey', bodyKey: 'deepseekApiKey' },
  gemini: { statusPath: '/wallet/gemini-apikey/status', setPath: '/wallet/gemini-apikey', bodyKey: 'geminiApiKey' },
  openai: { statusPath: '/wallet/openai-apikey/status', setPath: '/wallet/openai-apikey', bodyKey: 'openaiApiKey' },
};

function providerFromModel(model?: string, fallback?: string): MarketplaceProvider | null {
  const value = (model || fallback || '').toLowerCase();
  if (!value) return null;
  if (value.startsWith('minimax') || value.includes('minimax')) return 'minimax';
  if (value.startsWith('google/') || value.includes('openrouter')) return 'openrouter';
  if (value.startsWith('glm') || value.includes('z.ai') || value.includes('zai')) return 'zai';
  if (value.startsWith('deepseek')) return 'deepseek';
  if (value.startsWith('gemini')) return 'gemini';
  if (value.startsWith('gpt-') || value.startsWith('o1') || value.startsWith('o3') || value.startsWith('o4') || value.includes('openai')) return 'openai';
  if (value === 'haiku' || value === 'sonnet' || value === 'opus' || value.includes('claude')) return 'anthropic';
  return null;
}

function providerFromMissingSecret(value: unknown): MarketplaceProvider | null {
  const raw = typeof value === 'string' ? value : '';
  const lower = raw.toLowerCase();
  if (lower.includes('minimax')) return 'minimax';
  if (lower.includes('openrouter')) return 'openrouter';
  if (lower.includes('z.ai') || lower.includes('zai')) return 'zai';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('gemini')) return 'gemini';
  if (lower.includes('openai')) return 'openai';
  if (lower.includes('anthropic')) return 'anthropic';
  return null;
}

function parseJsonBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export class AgentClient {
  private readonly gatewayUrl: string;
  private readonly privateKey: `0x${string}` | null;
  private readonly signMessageFn: WalletSignMessage | null;
  private readonly tokenGetter: (() => Promise<string | undefined>) | null;
  private token: string | null = null;
  private sessions: SessionStoreType | null = null;
  private readonly sessionCache = new Map<string, string>();
  private readonly signToDeriveSignatureCache = new Map<string, string>();

  constructor(options: AgentClientConfig) {
    if (!options.privateKey && !options.token && !options.tokenGetter) {
      throw new AgentError(AgentErrorCode.VALIDATION_ERROR, 'Either privateKey, token, or tokenGetter is required');
    }
    if (options.privateKey) {
      const key = options.privateKey.startsWith('0x')
        ? options.privateKey
        : `0x${options.privateKey}`;
      this.privateKey = key as `0x${string}`;
    } else {
      this.privateKey = null;
    }
    this.signMessageFn = options.signMessage ?? null;
    this.tokenGetter = options.tokenGetter ?? null;
    this.gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    if (options.token) {
      this.token = options.token;
    }
    // SessionStore uses Node.js fs/path — only import in Node.js environments
    if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
      const dynamicImport = new Function('specifier', 'return import(specifier)') as (
        specifier: string,
      ) => Promise<{ SessionStore: new (filePath?: string | null) => SessionStoreType }>;
      dynamicImport('./session-store.js').then(({ SessionStore }) => {
        this.sessions = new SessionStore(options.sessionStorePath);
        for (const [agentId, sessionId] of this.sessionCache.entries()) {
          this.sessions.set(agentId, sessionId);
        }
      }).catch(() => {});
    }
  }

  /** Replace the current bearer token. Useful for browser wallet adapters that manage auth outside AgentClient. */
  setAuthToken(token: string | null): void {
    this.token = token;
  }

  // ─── BYOK API Key Management ─────────────────────────────

  /**
   * Store a BYOK Anthropic API key in the gateway vault (encrypted in-memory).
   * Enables 10%-markup-only pricing for this wallet.
   */
  async configureApiKey(apiKey: string): Promise<void> {
    if (!apiKey.startsWith('sk-ant-')) {
      throw new Error('Invalid Anthropic API key: must start with "sk-ant-"');
    }
    await this.setProviderApiKey('anthropic', apiKey);
  }

  /**
   * Check if a BYOK Anthropic API key is configured for this wallet.
   */
  async isApiKeyConfigured(): Promise<boolean> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/apikey/status`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to check API key status: ${res.status}`);
    }
    const data = await res.json();
    return data.configured === true;
  }

  /** Get Anthropic API key status. */
  async getApiKeyStatus(): Promise<ProviderApiKeyStatus> {
    return this.getProviderApiKeyStatus('anthropic');
  }

  /** Set Anthropic API key (alias for configureApiKey with agentbook-style body). */
  async setApiKey(apiKey: string): Promise<ProviderApiKeyStatus> {
    return this.setProviderApiKey('anthropic', apiKey);
  }

  /** Get provider BYOK key status for this wallet. */
  async getProviderApiKeyStatus(provider: MarketplaceProvider): Promise<ProviderApiKeyStatus> {
    await this.ensureAuthenticated();
    const spec = PROVIDER_CONFIG[provider];
    const res = await fetch(`${this.gatewayUrl}${spec.statusPath}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) return { configured: false };
    return res.json();
  }

  /** Store a provider BYOK key. Uses sign-to-derive when a wallet signer is available. */
  async setProviderApiKey(provider: MarketplaceProvider, apiKey: string): Promise<ProviderApiKeyStatus> {
    const spec = PROVIDER_CONFIG[provider];
    if (spec.keyPrefix && !apiKey.startsWith(spec.keyPrefix)) {
      throw new Error(`Invalid ${provider} API key: must start with "${spec.keyPrefix}"`);
    }

    await this.ensureAuthenticated();
    const body: Record<string, string> = { [spec.bodyKey]: apiKey };
    if (this.canSignForDerive()) {
      const { message, nonce } = await this.getProviderVaultDeriveChallenge();
      body.signature = await this.signForDerive(message);
      body.nonce = nonce;
    }
    const res = await fetch(`${this.gatewayUrl}${spec.setPath}`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to set ${provider} API key: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** Unlock provider BYOK keys for this gateway session using the owner wallet signature. */
  async unlockProviderVault(providers?: MarketplaceProvider[]): Promise<ProviderVaultUnlockResult> {
    await this.ensureAuthenticated();
    const { message, nonce } = await this.getProviderVaultDeriveChallenge();
    const signature = await this.signForDerive(message);
    const res = await fetch(`${this.gatewayUrl}/wallet/provider-vault/unlock`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ signature, nonce, providers }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to unlock provider vault: ${res.status} ${body}`);
    }
    return res.json();
  }

  /** Ensure a configured sign-to-derive provider key is unlocked, prompting the wallet signer only if needed. */
  async ensureProviderUnlocked(provider: MarketplaceProvider): Promise<boolean> {
    if (!this.canSignForDerive()) return false;
    const status = await this.getProviderApiKeyStatus(provider);
    if (!status.configured) return false;
    if (status.encryptionMode !== 'sign-to-derive' || status.unlocked !== false) return true;
    const result = await this.unlockProviderVault([provider]);
    return result.unlockedProviders.includes(provider);
  }

  /** Delete Anthropic API key. */
  async deleteApiKey(): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/apikey`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete API key: ${res.status}`);
  }

  // ─── OpenAI BYOK + Codex Subscription Auth ───────────────────

  /** Get OpenAI BYOK key status for Codex execution. */
  async getOpenAIApiKeyStatus(): Promise<ProviderApiKeyStatus> {
    return this.getProviderApiKeyStatus('openai');
  }

  /** Delete stored OpenAI BYOK key for this wallet. */
  async deleteOpenAIApiKey(): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/openai-apikey`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete OpenAI API key: ${res.status}`);
  }

  // ─── Gemini BYOK ─────────────────────────────────────────

  /** Get Gemini BYOK key status for this wallet. */
  async getGeminiApiKeyStatus(): Promise<ProviderApiKeyStatus> {
    return this.getProviderApiKeyStatus('gemini');
  }

  /** Store a Gemini BYOK key for this wallet. Browser apps should prefer the sign-to-derive flow. */
  async setGeminiApiKey(geminiApiKey: string): Promise<ProviderApiKeyStatus> {
    return this.setProviderApiKey('gemini', geminiApiKey);
  }

  /** Delete stored Gemini BYOK key for this wallet. */
  async deleteGeminiApiKey(): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/gemini-apikey`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete Gemini API key: ${res.status}`);
  }

  /** Get wallet Codex subscription auth status. */
  async getCodexAuthStatus(): Promise<CodexAuthStatus> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/codex-auth/status`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get Codex auth status: ${res.status} ${body}`);
    }
    return res.json();
  }

  /** Upload a local Codex CLI auth.json object for subscription-backed Codex execution. */
  async setCodexAuth(authJson: unknown): Promise<CodexAuthStatus> {
    await this.ensureAuthenticated();
    const { message, nonce } = await this.getCodexAuthDeriveChallenge();
    const signature = await this.signWithPrivateKey(message, 'Codex subscription auth sync requires the owner wallet private key');
    const res = await fetch(`${this.gatewayUrl}/wallet/codex-auth`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ authJson, signature, nonce }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to set Codex auth: ${res.status} ${body}`);
    }
    return res.json();
  }

  /** Unlock encrypted Codex subscription auth for this gateway session. */
  async unlockCodexAuth(): Promise<CodexAuthStatus> {
    await this.ensureAuthenticated();
    const { message } = await this.getCodexAuthDeriveChallenge();
    const signature = await this.signWithPrivateKey(message, 'Codex subscription auth unlock requires the owner wallet private key');
    const res = await fetch(`${this.gatewayUrl}/wallet/codex-auth/unlock`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ signature }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to unlock Codex auth: ${res.status} ${body}`);
    }
    return res.json();
  }

  /** Delete wallet Codex subscription auth. */
  async deleteCodexAuth(): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/codex-auth`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete Codex auth: ${res.status}`);
  }

  private async getCodexAuthDeriveChallenge(): Promise<{ message: string; nonce: string }> {
    const res = await fetch(`${this.gatewayUrl}/wallet/codex-auth/derive-challenge`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get Codex auth signing challenge: ${res.status} ${body}`);
    }
    return res.json();
  }

  // ─── Reflect & KB Tools (Builder) ─────────────────────────

  async getReflectStatus(agentId: string): Promise<ReflectStatus> {
    if (!agentId) throw new Error('agentId is required');
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom/${encodeURIComponent(agentId)}/reflect`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get reflect status: ${res.status} ${body}`);
    }
    return res.json();
  }

  async updateReflectConfig(
    agentId: string,
    config: { enabled?: boolean; config?: Partial<ReflectConfig> },
  ): Promise<Pick<ReflectStatus, 'reflectEnabled' | 'reflectConfig'>> {
    if (!agentId) throw new Error('agentId is required');
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom/${encodeURIComponent(agentId)}/reflect`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to update reflect config: ${res.status} ${body}`);
    }
    return res.json();
  }

  async setKnowledgeBookToken(agentId: string, kbToken: string): Promise<void> {
    if (!agentId) throw new Error('agentId is required');
    if (!kbToken) throw new Error('kbToken is required');
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom/${encodeURIComponent(agentId)}/reflect/kb-token`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ kbToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to set KnowledgeBook token: ${res.status} ${body}`);
    }
  }

  async getKnowledgeBookTools(agentId: string): Promise<KbToolsStatus> {
    if (!agentId) throw new Error('agentId is required');
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom/${encodeURIComponent(agentId)}/kb-tools`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get KnowledgeBook tools config: ${res.status} ${body}`);
    }
    return res.json();
  }

  async setKnowledgeBookTools(agentId: string, enabled: boolean): Promise<KbToolsStatus> {
    if (!agentId) throw new Error('agentId is required');
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom/${encodeURIComponent(agentId)}/kb-tools`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to update KnowledgeBook tools config: ${res.status} ${body}`);
    }
    return res.json();
  }

  // ─── Custom Agent Provisioning ─────────────────────────────

  async upsertCustomAgent(definition: CustomAgentDefinition): Promise<CustomAgentUpsertResult> {
    if (!definition || typeof definition !== 'object') {
      throw new Error('definition is required');
    }
    if (!definition.id || !definition.name) {
      throw new Error('definition.id and definition.name are required');
    }
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ definition }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to upsert custom agent: ${res.status} ${body}`);
    }
    return res.json();
  }

  async getCustomAgent(agentId: string): Promise<Record<string, unknown>> {
    if (!agentId) throw new Error('agentId is required');
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/custom/${encodeURIComponent(agentId)}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get custom agent: ${res.status} ${body}`);
    }
    return res.json();
  }

  // ─── Chat ────────────────────────────────────────────────

  /**
   * Send a message to an agent and return the full response.
   *
   * Handles authentication, session creation, SSE parsing, and text accumulation.
   * Use callbacks (onText, onToolCall, onToolResult) for real-time streaming.
   */
  async chat(agentId: string, message: string, options?: ChatOptions): Promise<ChatResult> {
    if (!agentId) throw new AgentError(AgentErrorCode.VALIDATION_ERROR, 'agentId is required');
    if (!message) throw new AgentError(AgentErrorCode.VALIDATION_ERROR, 'message is required');

    await this.ensureAuthenticated();

    // Get or create session
    const sessionId = options?.sessionId ?? await this.getOrCreateSession(agentId, options?.model, options?.executionEngine);
    if (options?.sessionId) {
      this.cacheSession(agentId, options.sessionId);
    }

    const sendChatRequest = async (): Promise<Response> => {
      try {
        return await fetch(
          `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/chat`,
          {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({
              message,
              model: options?.model,
            }),
          },
        );
      } catch (err) {
        throw this.wrapTransportError(err, sessionId);
      }
    };

    // Retry the entire request+parse cycle on transport/network errors
    const maxRetries = options?.maxRetries ?? 3;
    let authRetried = false;
    let providerUnlockRetried = false;
    return await this.retryWithBackoff(async () => {
      let res = await sendChatRequest();

      // Retry once on 401 with re-auth (only on first occurrence)
      if (res.status === 401 && this.privateKey && !authRetried) {
        authRetried = true;
        this.token = null;
        await this.ensureAuthenticated();
        res = await sendChatRequest();
      }

      if (!res.ok) {
        let body = await res.text();
        if (!providerUnlockRetried && await this.tryUnlockProviderFromErrorBody(body, options?.model)) {
          providerUnlockRetried = true;
          res = await sendChatRequest();
          if (res.ok) {
            return await this.parseSSEResponse(res, sessionId, options);
          }
          body = await res.text();
        }
        if (res.status === 401) {
          throw new AgentError(AgentErrorCode.AUTH_EXPIRED, 'Authentication expired. Run `rickydata auth login` to re-authenticate.', { agentId, sessionId });
        }
        throw AgentError.fromHttpStatus(res.status, body, { agentId, sessionId, operation: 'chat' });
      }

      try {
        return await this.parseSSEResponse(res, sessionId, options);
      } catch (err) {
        throw this.wrapTransportError(err, sessionId);
      }
    }, maxRetries);
  }

  /**
   * Send a raw chat request and return the Response for SSE streaming.
   * Caller is responsible for parsing the SSE stream.
   *
   * @param images - Optional image attachments for multimodal (screenshare) support.
   *   Each image must have a base64-encoded `data` field and a `mediaType`.
   *   Empty arrays are treated the same as omitting the parameter.
   */
  async chatRaw(agentId: string, sessionId: string, message: string, model?: string, images?: ImageAttachment[]): Promise<Response> {
    await this.ensureAuthenticated();
    const send = () => fetch(
      `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/chat`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ message, model, ...(images?.length ? { images } : {}) }),
      },
    );
    let res = await send();
    if (!res.ok) {
      const rawBody = typeof res.text === 'function'
        ? await res.text().catch(() => '')
        : JSON.stringify(await res.json().catch(() => ({ error: res.statusText })));
      if (await this.tryUnlockProviderFromErrorBody(rawBody, model)) {
        res = await send();
        if (res.ok) return res;
      }
      const errBody = parseJsonBody(rawBody) ?? { error: rawBody || res.statusText };
      const msg = (errBody as { message?: string; error?: string }).message
        || (errBody as { error?: string }).error
        || `Chat failed: ${res.status}`;
      throw AgentError.fromHttpStatus(res.status, msg, { agentId, sessionId, operation: 'chatRaw' });
    }
    return res;
  }

  /**
   * Return the cached session ID for an agent (if any).
   * Useful for CLI recovery after transient stream disconnects.
   */
  getCachedSessionId(agentId: string): string | undefined {
    return this.getCachedSession(agentId);
  }

  // ─── Discovery ───────────────────────────────────────────

  /**
   * List all published agents on the gateway.
   * Does not require authentication.
   */
  async listAgents(): Promise<AgentInfo[]> {
    const res = await fetch(`${this.gatewayUrl}/agents`);
    if (!res.ok) {
      throw new Error(`Failed to list agents: ${res.status}`);
    }
    const data = await res.json();
    return data.agents ?? [];
  }

  /** Get full agent detail (tools, skills). Does not require auth. */
  async getAgent(agentId: string): Promise<AgentDetailResponse> {
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}`);
    if (!res.ok) throw new Error(`Failed to get agent: ${res.status}`);
    return res.json();
  }

  // ─── Session Management ───────────────────────────────────

  /** Create a new chat session for an agent. */
  async createSession(agentId: string, model: string = 'haiku', executionEngine?: TeamExecutionEngine): Promise<SessionCreateResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ model, ...(executionEngine ? { executionEngine } : {}) }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      const msg = (errBody as { message?: string; error?: string }).message
        || (errBody as { error?: string }).error
        || `Failed to create session: ${res.status}`;
      const err = new Error(msg);
      (err as Error & { status: number }).status = res.status;
      throw err;
    }
    const data: SessionCreateResponse = await res.json();
    this.cacheSession(agentId, data.id);
    return data;
  }

  /** List sessions for an agent. */
  async listSessions(agentId: string): Promise<SessionListEntry[]> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
    const data = await res.json();
    return data.sessions ?? data;
  }

  /** Get session detail including messages. */
  async getSession(agentId: string, sessionId: string): Promise<SessionDetail> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to get session: ${res.status}`);
    return res.json();
  }

  /** Delete a session. */
  async deleteSession(agentId: string, sessionId: string): Promise<void> {
    await this.ensureAuthenticated();
    await fetch(
      `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );
  }

  // ─── MCP Secret Management ───────────────────────────────

  /** Get MCP server secret requirements for an agent. */
  async getMcpRequirements(agentId: string): Promise<McpRequirementsResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/mcp-requirements`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to get MCP requirements: ${res.status}`);
    return res.json();
  }

  /** Store secrets for an MCP server. */
  async storeMcpSecrets(serverId: string, secrets: Record<string, string>): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/mcp-secrets/${encodeURIComponent(serverId)}`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ secrets }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error || `Failed to store secrets: ${res.status}`);
    }
  }

  /** Get configured secret keys for an MCP server. */
  async getMcpSecretStatus(serverId: string): Promise<{ configuredSecrets: string[] }> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/mcp-secrets/${encodeURIComponent(serverId)}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to get secret status: ${res.status}`);
    return res.json();
  }

  /** Delete all secrets for an MCP server. */
  async deleteMcpSecrets(serverId: string): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/mcp-secrets/${encodeURIComponent(serverId)}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to delete secrets: ${res.status}`);
  }

  /** Retrieve all MCP server secret values. Only accessible by the storing wallet. */
  async getMcpSecretValues(serverId: string): Promise<{ key: string; value: string }[]> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/mcp-secrets/${encodeURIComponent(serverId)}/values`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to get MCP secret values: ${res.status}`);
    const data = await res.json();
    return data.secrets ?? [];
  }

  /** Retrieve a single MCP server secret value. Returns null if not configured. */
  async getMcpSecretValue(serverId: string, key: string): Promise<string | null> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/mcp-secrets/${encodeURIComponent(serverId)}/values/${encodeURIComponent(key)}`,
      { headers: this.authHeaders() },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to get MCP secret value: ${res.status}`);
    const data = await res.json();
    return data.value ?? null;
  }

  // ─── Agent Secret Management ─────────────────────────────

  /** Get agent-level secret status. */
  async getAgentSecretStatus(agentId: string): Promise<AgentSecretStatus> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/agent-secrets/${encodeURIComponent(agentId)}`,
      { headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to get agent secret status: ${res.status}`);
    return res.json();
  }

  /** Store agent-level secrets. */
  async storeAgentSecrets(agentId: string, secrets: Record<string, string>): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/agent-secrets/${encodeURIComponent(agentId)}`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ secrets }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error || `Failed to store agent secrets: ${res.status}`);
    }
  }

  /** Delete agent-level secrets. */
  async deleteAgentSecrets(agentId: string): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/wallet/agent-secrets/${encodeURIComponent(agentId)}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );
    if (!res.ok) throw new Error(`Failed to delete agent secrets: ${res.status}`);
  }

  // ─── Wallet Settings ─────────────────────────────────────

  /** Get wallet settings. */
  async getWalletSettings(): Promise<WalletSettings> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/settings`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get wallet settings: ${res.status}`);
    return res.json();
  }

  /** Update wallet settings (partial merge). */
  async updateWalletSettings(settings: Partial<WalletSettings>): Promise<WalletSettings> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/settings`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`Failed to update wallet settings: ${res.status}`);
    return res.json();
  }

  /** Get free tier usage status. */
  async getFreeTierStatus(): Promise<FreeTierStatus> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/free-tier/status`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      throw AgentError.fromHttpStatus(res.status, await res.text());
    }
    return res.json();
  }

  // ─── Wallet Balance & Transactions ────────────────────────

  /** Get wallet balance. */
  async getWalletBalance(): Promise<WalletBalanceResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/balance`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get balance: ${res.status}`);
    return res.json();
  }

  /** Get wallet transaction history. */
  async getWalletTransactions(limit?: number, offset?: number): Promise<WalletTransactionsResponse> {
    await this.ensureAuthenticated();
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const qs = params.toString() ? `?${params}` : '';
    const res = await fetch(`${this.gatewayUrl}/wallet/transactions${qs}`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get transactions: ${res.status}`);
    return res.json();
  }

  // ─── Voice ────────────────────────────────────────────────

  /** Get ephemeral voice token for WebRTC connection. */
  async getVoiceToken(agentId: string, config: { model?: string; voice?: string }): Promise<VoiceTokenResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/voice/token`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      const msg = (body as { message?: string; error?: string }).message
        || (body as { error?: string }).error
        || `Failed to get voice token: ${res.status}`;
      const err = new Error(msg);
      (err as Error & { status: number }).status = res.status;
      throw err;
    }
    return res.json();
  }

  /** Get a LiveKit token for voice chat (returns url, roomName, sessionId for LiveKit Room.connect). */
  async getVoiceLivekitToken(agentId: string, config: { voice?: string }): Promise<VoiceLivekitTokenResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/voice/livekit-token`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      const msg = (body as { message?: string; error?: string }).message
        || (body as { error?: string }).error
        || `Failed to get LiveKit voice token: ${res.status}`;
      const err = new Error(msg);
      (err as Error & { status: number }).status = res.status;
      throw err;
    }
    return res.json();
  }

  /** Execute a tool call during a voice session. */
  async executeVoiceToolCall(agentId: string, toolCall: VoiceToolCallRequest): Promise<VoiceToolCallResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/voice/tool-call`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(toolCall),
    });
    if (!res.ok) throw new Error(`Failed to execute voice tool call: ${res.status}`);
    return res.json();
  }

  /** Start a voice billing session. */
  async startVoiceSession(agentId: string, session: { model: string }): Promise<{ sessionId: string }> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/voice/session/start`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(session),
    });
    if (!res.ok) throw new Error(`Failed to start voice session: ${res.status}`);
    return res.json();
  }

  /** End a voice billing session. */
  async endVoiceSession(
    agentId: string,
    session: {
      sessionId: string;
      durationMs: number;
      usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    },
  ): Promise<VoiceEndResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/voice/session/end`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        sessionId: session.sessionId,
        durationMs: session.durationMs,
        usage: session.usage,
      }),
    });
    if (!res.ok) throw new Error(`Failed to end voice session: ${res.status}`);
    return res.json();
  }

  // ─── Team Workflow ────────────────────────────────────────

  /** Execute a team workflow and return the Response for SSE streaming. */
  async executeTeamWorkflow(payload: TeamWorkflowPayload, options?: TeamWorkflowOptions): Promise<Response> {
    await this.ensureAuthenticated();

    const timeoutMs = options?.timeoutMs ?? 300_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const signal = options?.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;

    try {
      const res = await fetch(`${this.gatewayUrl}/canvas/workflows/execute/stream`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const msg = (err as { message?: string; error?: string }).message
          || (err as { error?: string }).error
          || `Team workflow failed: ${res.status}`;
        throw AgentError.fromHttpStatus(res.status, msg, { operation: 'executeTeamWorkflow' });
      }
      return res;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AgentError(AgentErrorCode.NETWORK_TIMEOUT, 'Team workflow timed out', { operation: 'executeTeamWorkflow' });
      }
      if (err instanceof AgentError) throw err;
      throw new AgentError(AgentErrorCode.NETWORK_ERROR, String(err), { operation: 'executeTeamWorkflow' });
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Internal: Auth ──────────────────────────────────────

  private async ensureAuthenticated(): Promise<void> {
    if (this.token) return;

    // Try tokenGetter first (for browser/React use)
    if (this.tokenGetter) {
      const t = await this.tokenGetter();
      if (!t) throw new AgentError(AgentErrorCode.AUTH_FAILED, 'Token getter returned no token');
      this.token = t;
      return;
    }

    if (!this.privateKey) {
      throw new AgentError(AgentErrorCode.AUTH_REQUIRED, 'Cannot authenticate: no privateKey, token, or tokenGetter configured');
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey);

    // 1. Get challenge
    const challengeRes = await fetch(`${this.gatewayUrl}/auth/challenge`);
    if (!challengeRes.ok) {
      throw new AgentError(AgentErrorCode.AUTH_FAILED, `Auth challenge failed: ${challengeRes.status}`, { statusCode: challengeRes.status });
    }
    const { nonce, message: challengeMessage } = await challengeRes.json();

    // 2. Sign challenge
    const signature = await account.signMessage({ message: challengeMessage });

    // 3. Verify
    const verifyRes = await fetch(`${this.gatewayUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: account.address,
        signature,
        nonce,
      }),
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      throw new AgentError(AgentErrorCode.AUTH_FAILED, `Auth verification failed: ${verifyRes.status} ${body}`, { statusCode: verifyRes.status });
    }
    const { token } = await verifyRes.json();
    this.token = token;
  }

  private canSignForDerive(): boolean {
    return !!this.privateKey || !!this.signMessageFn;
  }

  private async getProviderVaultDeriveChallenge(): Promise<{ message: string; nonce: string }> {
    const res = await fetch(`${this.gatewayUrl}/wallet/provider-vault/derive-challenge`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get provider vault signing challenge: ${res.status} ${body}`);
    }
    return res.json();
  }

  private async signForDerive(message: string): Promise<string> {
    const cached = this.signToDeriveSignatureCache.get(message);
    if (cached) return cached;
    const signature = this.signMessageFn
      ? await this.signMessageFn(message)
      : await this.signWithPrivateKey(message, 'Provider vault unlock requires the owner wallet signature');
    this.signToDeriveSignatureCache.set(message, signature);
    return signature;
  }

  private providerFromLockedSecretBody(body: string, model?: string): MarketplaceProvider | null {
    const parsed = parseJsonBody(body);
    if (!parsed) return null;
    const needsUnlock = parsed.needsUnlock === true || parsed.error === 'locked_secrets';
    if (!needsUnlock) return null;

    const missingSecrets = Array.isArray(parsed.missingSecrets) ? parsed.missingSecrets : [];
    for (const entry of missingSecrets) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const provider = providerFromMissingSecret(record.serverId)
        ?? providerFromMissingSecret(record.serverName);
      if (provider) return provider;
      const keys = Array.isArray(record.secretKeys) ? record.secretKeys : [];
      for (const key of keys) {
        const fromKey = providerFromMissingSecret(key);
        if (fromKey) return fromKey;
      }
    }

    return providerFromMissingSecret(String(parsed.message ?? '')) ?? providerFromModel(model);
  }

  private async tryUnlockProviderFromErrorBody(body: string, model?: string): Promise<boolean> {
    if (!this.canSignForDerive()) return false;
    const provider = this.providerFromLockedSecretBody(body, model);
    if (!provider) return false;
    try {
      const result = await this.unlockProviderVault([provider]);
      return result.unlockedProviders.includes(provider);
    } catch {
      return false;
    }
  }

  private async signWithPrivateKey(message: string, missingKeyMessage: string): Promise<string> {
    if (!this.privateKey) {
      throw new AgentError(AgentErrorCode.AUTH_REQUIRED, missingKeyMessage);
    }
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey);
    return account.signMessage({ message });
  }

  private async getOrCreateSession(agentId: string, model?: string, executionEngine?: TeamExecutionEngine): Promise<string> {
    const existing = this.getCachedSession(agentId);
    if (existing) return existing;

    let res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ model: model ?? 'haiku', ...(executionEngine ? { executionEngine } : {}) }),
    });

    if (res.status === 401 && this.privateKey) {
      // Token expired — re-authenticate and retry
      this.token = null;
      await this.ensureAuthenticated();
      res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ model: model ?? 'haiku', ...(executionEngine ? { executionEngine } : {}) }),
      });
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401) {
        throw new AgentError(AgentErrorCode.AUTH_EXPIRED, 'Authentication expired. Run `rickydata auth login` to re-authenticate.', { agentId });
      }
      throw AgentError.fromHttpStatus(res.status, body, { agentId, operation: 'createSession' });
    }
    const data = await res.json();
    this.cacheSession(agentId, data.id);
    return data.id;
  }

  private getCachedSession(agentId: string): string | undefined {
    const inMemory = this.sessionCache.get(agentId);
    if (inMemory) return inMemory;

    const persisted = this.sessions?.get(agentId);
    if (persisted) {
      this.sessionCache.set(agentId, persisted);
    }
    return persisted;
  }

  private cacheSession(agentId: string, sessionId: string): void {
    this.sessionCache.set(agentId, sessionId);
    this.sessions?.set(agentId, sessionId);
  }

  private authHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
    };
  }

  // ─── Internal: Retry ────────────────────────────────────

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delays: number[] = [100, 500, 2000],
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const isRetryable =
          (err instanceof AgentError && err.isRetryable) ||
          (err instanceof Error &&
            (/timed out|timeout|terminated|abort|network|socket|fetch failed/i.test(err.message)));
        if (!isRetryable || attempt >= maxRetries) {
          throw err;
        }
        const delay = delays[Math.min(attempt, delays.length - 1)];
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError; // unreachable, but satisfies TypeScript
  }

  // ─── Internal: SSE Parsing ───────────────────────────────

  private wrapTransportError(error: unknown, sessionId: string): AgentError | Error {
    if (error instanceof AgentError) return error;
    if (error instanceof Error) {
      if (error.message.startsWith('Agent error:')) {
        return error;
      }
      const msg = error.message.toLowerCase();
      const isTimeout = msg.includes('timed out') || msg.includes('timeout');
      const interrupted = isTimeout
        || msg.includes('terminated')
        || msg.includes('abort')
        || msg.includes('network')
        || msg.includes('socket')
        || msg.includes('fetch failed');
      if (interrupted) {
        return new AgentError(
          isTimeout ? AgentErrorCode.NETWORK_TIMEOUT : AgentErrorCode.CONNECTION_INTERRUPTED,
          `Connection interrupted while streaming response. ` +
          'The session may still be active; retry the message or resume this session.',
          { sessionId },
        );
      }
      return error;
    }
    return new AgentError(
      AgentErrorCode.CONNECTION_INTERRUPTED,
      `Connection interrupted while streaming response. ` +
      'The session may still be active; retry the message or resume this session.',
      { sessionId },
    );
  }

  private async parseSSEResponse(
    response: Response,
    sessionId: string,
    options?: ChatOptions,
  ): Promise<ChatResult> {
    const body = response.body;
    if (!body) {
      return { text: '', sessionId };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let model: string | undefined;
    let executionEngine: TeamExecutionEngine | undefined;
    let engineUsed: TeamExecutionEngine | undefined;
    let codexAuthSource: 'openai_api_key' | 'subscription' | undefined;
    let cost: string | undefined;
    let toolCallCount: number | undefined;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

    try {
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch {
          if (text) {
            // We already got some text — return what we have rather than throwing
            break;
          }
          throw new AgentError(
            AgentErrorCode.CONNECTION_INTERRUPTED,
            'Connection interrupted while streaming response. ' +
            'The session may still be active; retry the message or resume this session.',
            { sessionId },
          );
        }
        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          const dataLine = extractSSEData(chunk);
          if (dataLine) {
            try {
              const event: SSEEvent = JSON.parse(dataLine);
              switch (event.type) {
                case 'text':
                  text += event.data;
                  options?.onText?.(event.data);
                  break;
                case 'tool_call':
                  options?.onToolCall?.({
                    name: event.data.name,
                    displayName: event.data.displayName,
                    args: event.data.args,
                  });
                  break;
                case 'tool_result':
                  options?.onToolResult?.({
                    name: event.data.name,
                    result: event.data.result ?? event.data.content,
                    isError: event.data.isError,
                  });
                  break;
                case 'done':
                  model = event.data.model;
                  cost = event.data.cost;
                  toolCallCount = event.data.toolCallCount;
                  usage = event.data.usage;
                  executionEngine = event.data.executionEngine;
                  engineUsed = event.data.engineUsed;
                  codexAuthSource = event.data.codexAuthSource;
                  break;
                case 'error':
                  throw new AgentError(AgentErrorCode.AGENT_ERROR, event.data.message ?? JSON.stringify(event.data), { sessionId });
              }
            } catch (e) {
              if (e instanceof AgentError) throw e;
              // Skip malformed JSON
            }
          }

          boundary = buffer.indexOf('\n\n');
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const dataLine = extractSSEData(buffer);
        if (dataLine) {
          try {
            const event: SSEEvent = JSON.parse(dataLine);
            if (event.type === 'text') {
              text += event.data;
              options?.onText?.(event.data);
            } else if (event.type === 'done') {
              model = event.data.model;
              cost = event.data.cost;
              toolCallCount = event.data.toolCallCount;
              usage = event.data.usage;
              executionEngine = event.data.executionEngine;
              engineUsed = event.data.engineUsed;
              codexAuthSource = event.data.codexAuthSource;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text, sessionId, model, executionEngine, engineUsed, codexAuthSource, cost, toolCallCount, usage };
  }
}

// ─── Standalone SSE Parsers ─────────────────────────────────

/**
 * Extract the data payload from an SSE chunk.
 */
export function extractSSEData(chunk: string): string | null {
  const lines = chunk.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5));
    }
  }

  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

/**
 * Parse an SSE stream from a chat response.
 * Standalone version for use outside of AgentClient (e.g., React hooks).
 */
export async function streamSSEEvents(
  response: Response,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError(AgentErrorCode.NETWORK_ERROR, 'No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const createTimeoutPromise = (): Promise<never> => {
    clearTimeout(timeoutId);
    return new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentError(AgentErrorCode.NETWORK_TIMEOUT, 'Connection timed out — no response for 60s')),
        SSE_READ_TIMEOUT_MS,
      );
    });
  };

  try {
    while (true) {
      const timeoutPromise = createTimeoutPromise();
      const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (part.startsWith(':')) continue;
        if (part.startsWith('data: ')) {
          try {
            const event = JSON.parse(part.slice(6)) as SSEEvent;
            onEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    }

    if (buffer.startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.slice(6)) as SSEEvent;
        onEvent(event);
      } catch {
        // Skip
      }
    }
  } catch (err) {
    try { reader.cancel(); } catch { /* ignore */ }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse an SSE stream from a team workflow response.
 */
export async function streamTeamSSEEvents(
  response: Response,
  onEvent: (event: TeamSSEEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentError(AgentErrorCode.NETWORK_ERROR, 'No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const createTimeoutPromise = (): Promise<never> => {
    clearTimeout(timeoutId);
    return new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentError(AgentErrorCode.NETWORK_TIMEOUT, 'Connection timed out — no response for 60s')),
        SSE_READ_TIMEOUT_MS,
      );
    });
  };

  try {
    while (true) {
      const timeoutPromise = createTimeoutPromise();
      const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (part.startsWith(':')) continue;
        if (part.startsWith('data: ')) {
          try {
            const event = JSON.parse(part.slice(6)) as TeamSSEEvent;
            onEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    }

    if (buffer.startsWith('data: ')) {
      try {
        const event = JSON.parse(buffer.slice(6)) as TeamSSEEvent;
        onEvent(event);
      } catch {
        // Skip
      }
    }
  } catch (err) {
    try { reader.cancel(); } catch { /* ignore */ }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build a team workflow payload from participant list.
 */
export function buildTeamWorkflowPayload(
  participants: { agentId: string; agentName: string; model?: string }[],
  orchestratorPrompt: string,
  orchestratorModel: string,
  userMessage: string,
  teamName: string,
): TeamWorkflowPayload {
  const inputNodeId = 'text-input-1';
  const orchestratorNodeId = 'agent-team-orchestrator-1';

  return {
    nodes: [
      { id: inputNodeId, type: 'text-input', data: { value: userMessage } },
      { id: orchestratorNodeId, type: 'agent-team-orchestrator', data: { teamName, prompt: orchestratorPrompt, model: orchestratorModel } },
    ],
    connections: [
      { source: inputNodeId, target: orchestratorNodeId },
    ],
    teamRuntime: {
      orchestratorNodeId,
      teammates: participants.map((p, i) => ({
        nodeId: `teammate-${i}`,
        teammateName: p.agentName,
        sourceType: 'marketplace' as const,
        sourceAgentId: p.agentId,
        model: p.model,
      })),
    },
  };
}
