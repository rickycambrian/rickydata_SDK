/**
 * High-level Agent Client
 *
 * Wraps the full Agent Gateway flow (auth, sessions, SSE streaming) into
 * a simple interface for chatting with agents.
 *
 * Uses viem for wallet signing (consistent with the rest of the SDK).
 */

import { SessionStore } from './session-store.js';
import {
  AgentError,
  AgentErrorCode,
} from './types.js';
import type {
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
  VoiceToolCallRequest,
  VoiceToolCallResponse,
  VoiceEndResponse,
  TeamWorkflowPayload,
  TeamSSEEvent,
  TeamWorkflowOptions,
} from './types.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';
const SSE_READ_TIMEOUT_MS = 60_000;

export class AgentClient {
  private readonly gatewayUrl: string;
  private readonly privateKey: `0x${string}` | null;
  private readonly tokenGetter: (() => Promise<string | undefined>) | null;
  private token: string | null = null;
  private sessions: SessionStore;

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
    this.tokenGetter = options.tokenGetter ?? null;
    this.gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    if (options.token) {
      this.token = options.token;
    }
    this.sessions = new SessionStore(options.sessionStorePath);
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
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/apikey`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ anthropicApiKey: apiKey }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to configure API key: ${res.status} ${body}`);
    }
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
  async getApiKeyStatus(): Promise<{ configured: boolean }> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/apikey/status`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) return { configured: false };
    return res.json();
  }

  /** Set Anthropic API key (alias for configureApiKey with agentbook-style body). */
  async setApiKey(apiKey: string): Promise<{ configured: boolean }> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/apikey`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) throw new Error(`Failed to set API key: ${res.status}`);
    return res.json();
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

  // ─── OpenAI API Key ──────────────────────────────────────

  async getOpenAIApiKeyStatus(): Promise<{ configured: boolean }> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/openai-apikey/status`, {
      headers: this.authHeaders(),
    });
    if (!res.ok) return { configured: false };
    return res.json();
  }

  async storeOpenAIApiKey(apiKey: string): Promise<{ configured: boolean }> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/openai-apikey`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ openaiApiKey: apiKey }),
    });
    if (!res.ok) throw new Error(`Failed to store OpenAI API key: ${res.status}`);
    return res.json();
  }

  async deleteOpenAIApiKey(): Promise<void> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/wallet/openai-apikey`, {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete OpenAI API key: ${res.status}`);
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
    const sessionId = options?.sessionId ?? await this.getOrCreateSession(agentId, options?.model);
    if (options?.sessionId) {
      this.sessions.set(agentId, options.sessionId);
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
        const body = await res.text();
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
   */
  async chatRaw(agentId: string, sessionId: string, message: string, model?: string): Promise<Response> {
    await this.ensureAuthenticated();
    const res = await fetch(
      `${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/chat`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ message, model }),
      },
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      const msg = (errBody as { message?: string; error?: string }).message
        || (errBody as { error?: string }).error
        || `Chat failed: ${res.status}`;
      const err = new Error(msg);
      (err as Error & { status: number }).status = res.status;
      throw err;
    }
    return res;
  }

  /**
   * Return the cached session ID for an agent (if any).
   * Useful for CLI recovery after transient stream disconnects.
   */
  getCachedSessionId(agentId: string): string | undefined {
    return this.sessions.get(agentId);
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
  async createSession(agentId: string, model: string = 'haiku'): Promise<SessionCreateResponse> {
    await this.ensureAuthenticated();
    const res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as { error?: string }).error || `Failed to create session: ${res.status}`);
    }
    const data: SessionCreateResponse = await res.json();
    this.sessions.set(agentId, data.id);
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
      throw new Error(msg);
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

  private async getOrCreateSession(agentId: string, model?: string): Promise<string> {
    const existing = this.sessions.get(agentId);
    if (existing) return existing;

    let res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ model: model ?? 'haiku' }),
    });

    if (res.status === 401 && this.privateKey) {
      // Token expired — re-authenticate and retry
      this.token = null;
      await this.ensureAuthenticated();
      res = await fetch(`${this.gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ model: model ?? 'haiku' }),
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
    this.sessions.set(agentId, data.id);
    return data.id;
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
                  cost = event.data.cost;
                  toolCallCount = event.data.toolCallCount;
                  usage = event.data.usage;
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
              cost = event.data.cost;
              toolCallCount = event.data.toolCallCount;
              usage = event.data.usage;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { text, sessionId, cost, toolCallCount, usage };
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
