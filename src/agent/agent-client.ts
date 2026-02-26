/**
 * High-level Agent Client
 *
 * Wraps the full Agent Gateway flow (auth, sessions, SSE streaming) into
 * a simple interface for chatting with agents.
 *
 * Uses viem for wallet signing (consistent with the rest of the SDK).
 */

import type {
  AgentClientConfig,
  AgentInfo,
  ChatOptions,
  ChatResult,
  SSEEvent,
  ReflectStatus,
  ReflectConfig,
  KbToolsStatus,
} from './types.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';

export class AgentClient {
  private readonly gatewayUrl: string;
  private readonly privateKey: `0x${string}` | null;
  private token: string | null = null;
  private sessions: Map<string, string> = new Map(); // agentId -> sessionId

  constructor(options: AgentClientConfig) {
    if (!options.privateKey && !options.token) {
      throw new Error('Either privateKey or token is required');
    }
    if (options.privateKey) {
      const key = options.privateKey.startsWith('0x')
        ? options.privateKey
        : `0x${options.privateKey}`;
      this.privateKey = key as `0x${string}`;
    } else {
      this.privateKey = null;
    }
    this.gatewayUrl = (options.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    if (options.token) {
      this.token = options.token;
    }
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

  // ─── Chat ────────────────────────────────────────────────

  /**
   * Send a message to an agent and return the full response.
   *
   * Handles authentication, session creation, SSE parsing, and text accumulation.
   * Use callbacks (onText, onToolCall, onToolResult) for real-time streaming.
   */
  async chat(agentId: string, message: string, options?: ChatOptions): Promise<ChatResult> {
    if (!agentId) throw new Error('agentId is required');
    if (!message) throw new Error('message is required');

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

    // Send chat request (retry once on 401 with re-auth)
    let res = await sendChatRequest();

    if (res.status === 401 && this.privateKey) {
      // Token expired — re-authenticate and retry
      this.token = null;
      await this.ensureAuthenticated();
      res = await sendChatRequest();
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401) {
        throw new Error(`Authentication expired. Run \`rickydata auth login\` to re-authenticate.`);
      }
      throw new Error(`Chat failed: ${res.status} ${body}`);
    }

    // Parse SSE stream
    try {
      return await this.parseSSEResponse(res, sessionId, options);
    } catch (err) {
      throw this.wrapTransportError(err, sessionId);
    }
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

  // ─── Internal: Auth ──────────────────────────────────────

  private async ensureAuthenticated(): Promise<void> {
    if (this.token) return;

    if (!this.privateKey) {
      throw new Error('Cannot authenticate: no privateKey or token configured');
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey);

    // 1. Get challenge
    const challengeRes = await fetch(`${this.gatewayUrl}/auth/challenge`);
    if (!challengeRes.ok) {
      throw new Error(`Auth challenge failed: ${challengeRes.status}`);
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
      throw new Error(`Auth verification failed: ${verifyRes.status} ${body}`);
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
        throw new Error(`Authentication expired. Run \`rickydata auth login\` to re-authenticate.`);
      }
      throw new Error(`Failed to create session: ${res.status} ${body}`);
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

  // ─── Internal: SSE Parsing ───────────────────────────────

  private wrapTransportError(error: unknown, sessionId: string): Error {
    if (error instanceof Error) {
      if (error.message.startsWith('Agent error:')) {
        return error;
      }
      const msg = error.message.toLowerCase();
      const interrupted = msg.includes('terminated')
        || msg.includes('abort')
        || msg.includes('network')
        || msg.includes('socket')
        || msg.includes('fetch failed');
      if (interrupted) {
        return new Error(
          `Connection interrupted while streaming response (sessionId: ${sessionId}). ` +
          'The session may still be active; retry the message or resume this session.'
        );
      }
      return error;
    }
    return new Error(
      `Connection interrupted while streaming response (sessionId: ${sessionId}). ` +
      'The session may still be active; retry the message or resume this session.'
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
          throw new Error(
            `Connection interrupted while streaming response (sessionId: ${sessionId}). ` +
            'The session may still be active; retry the message or resume this session.',
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
                  throw new Error(`Agent error: ${event.data.message ?? JSON.stringify(event.data)}`);
              }
            } catch (e) {
              if (e instanceof Error && e.message.startsWith('Agent error:')) throw e;
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

/**
 * Extract the data payload from an SSE chunk.
 */
function extractSSEData(chunk: string): string | null {
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
