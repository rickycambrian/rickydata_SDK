/**
 * AgentSession — High-level facade for agent interactions.
 *
 * Wraps AgentClient with auth + session management in one fluent interface.
 * Prefer AgentSession for application code; use AgentClient directly when you
 * need lower-level control (e.g., multiple agents, custom session IDs).
 *
 * Usage:
 *   const session = await AgentSession.connect(
 *     { privateKey: '0x...' },
 *     'research-agent',
 *   );
 *   const result = await session.send('What is DeFi?');
 *   console.log(result.text);
 *   await session.close();
 */

import { AgentClient } from './agent-client.js';
import type { ChatOptions, ChatResult } from './types.js';

export interface AgentSessionConfig {
  /** Private key for wallet-based authentication. Mutually exclusive with `token`. */
  privateKey?: string;
  /** Pre-existing auth token (wallet-token or JWT). Mutually exclusive with `privateKey`. */
  token?: string;
  /** Agent Gateway URL. Defaults to https://agents.rickydata.org */
  gatewayUrl?: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export class AgentSession {
  private readonly client: AgentClient;
  private readonly _agentId: string;
  private _sessionId: string;
  private readonly _history: Message[] = [];

  private constructor(client: AgentClient, agentId: string, sessionId: string) {
    this.client = client;
    this._agentId = agentId;
    this._sessionId = sessionId;
  }

  /**
   * Create a new AgentSession connected to the given agent.
   *
   * Authentication is handled automatically from `config.privateKey` or `config.token`.
   * A new chat session is established with the gateway during `connect()`.
   */
  static async connect(config: AgentSessionConfig, agentId: string): Promise<AgentSession> {
    if (!agentId) throw new Error('agentId is required');
    if (!config.privateKey && !config.token) {
      throw new Error('Either privateKey or token is required');
    }

    const client = new AgentClient({
      privateKey: config.privateKey,
      token: config.token,
      gatewayUrl: config.gatewayUrl,
    });

    // Send an empty first message won't work — we need to create a session
    // directly via the gateway's session endpoint.
    const sessionId = await AgentSession._createSession(client, agentId, config);

    return new AgentSession(client, agentId, sessionId);
  }

  /**
   * Send a message and return the full response.
   * The exchange is recorded in the session history.
   */
  async send(
    message: string,
    options?: {
      onText?: (text: string) => void;
      onToolCall?: (tool: { name: string; displayName?: string; args: unknown }) => void;
      onToolResult?: (result: { name: string; result?: string; isError: boolean }) => void;
      model?: 'haiku' | 'sonnet' | 'opus';
    },
  ): Promise<ChatResult> {
    if (!message) throw new Error('message is required');

    this._history.push({
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    const chatOptions: ChatOptions = {
      sessionId: this._sessionId,
      ...options,
    };

    const result = await this.client.chat(this._agentId, message, chatOptions);

    this._history.push({
      role: 'assistant',
      content: result.text,
      timestamp: new Date(),
    });

    return result;
  }

  /**
   * Resume an existing gateway session by ID.
   * Subsequent `send()` calls will use the provided session ID.
   */
  async resume(sessionId: string): Promise<void> {
    if (!sessionId) throw new Error('sessionId is required');
    this._sessionId = sessionId;
  }

  /**
   * Return the local in-memory message history for this session.
   * Only includes messages sent/received via this AgentSession instance.
   */
  async history(): Promise<Message[]> {
    return [...this._history];
  }

  /**
   * Close the session and clear local history.
   * Future gateway versions may expose a close endpoint.
   */
  async close(): Promise<void> {
    this._history.length = 0;
  }

  /** The current session ID (persist this to resume later). */
  get sessionId(): string {
    return this._sessionId;
  }

  /** The agent ID this session is connected to. */
  get agentId(): string {
    return this._agentId;
  }

  // ─── Internal ──────────────────────────────────────────────

  /**
   * Create a new session on the gateway and return its ID.
   * Mirrors AgentClient's private getOrCreateSession logic.
   */
  private static async _createSession(
    client: AgentClient,
    agentId: string,
    config: AgentSessionConfig,
  ): Promise<string> {
    const gatewayUrl = (config.gatewayUrl ?? 'https://agents.rickydata.org').replace(/\/$/, '');
    const authHeader = config.token ? `Bearer ${config.token}` : await AgentSession._getToken(client, gatewayUrl, config);

    const res = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ model: 'haiku' }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${body}`);
    }

    const data = await res.json();
    return data.id;
  }

  /**
   * Authenticate with the gateway and return an auth token for Authorization: Bearer.
   */
  private static async _getToken(
    _client: AgentClient,
    gatewayUrl: string,
    config: AgentSessionConfig,
  ): Promise<string> {
    if (!config.privateKey) {
      throw new Error('Cannot authenticate: no privateKey or token configured');
    }

    const { privateKeyToAccount } = await import('viem/accounts');
    const key = config.privateKey.startsWith('0x')
      ? config.privateKey as `0x${string}`
      : `0x${config.privateKey}` as `0x${string}`;
    const account = privateKeyToAccount(key);

    const challengeRes = await fetch(`${gatewayUrl}/auth/challenge`);
    if (!challengeRes.ok) {
      throw new Error(`Auth challenge failed: ${challengeRes.status}`);
    }
    const { nonce, message: challengeMessage } = await challengeRes.json();

    const signature = await account.signMessage({ message: challengeMessage });

    const verifyRes = await fetch(`${gatewayUrl}/auth/verify`, {
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
    return `Bearer ${token}`;
  }
}
