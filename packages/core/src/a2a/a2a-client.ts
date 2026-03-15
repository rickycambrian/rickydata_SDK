/**
 * A2A Protocol Client
 *
 * Client for communicating with A2A-compatible agent gateways.
 * Uses native fetch (Node 18+) — no external dependencies.
 */

import type {
  A2AClientConfig,
  AgentCard,
  ExtendedAgentCard,
  SendMessageRequest,
  Task,
  TaskListResponse,
  ListTasksOptions,
  StreamEvent,
  JsonRpcResponse,
  JsonRpcError,
} from './types.js';
import { extractSSEData } from '../agent/index.js';

const A2A_VERSION = '0.3';
const A2A_VERSION_HEADER = 'A2A-Version';

export class A2AError extends Error {
  public readonly code: number;
  public readonly data?: unknown;

  constructor(error: JsonRpcError) {
    super(error.message);
    this.name = 'A2AError';
    this.code = error.code;
    this.data = error.data;
  }
}

export class A2AClient {
  private baseUrl: string;
  private token: string | null;
  private runtimeScopeId: string | null;

  constructor(config: A2AClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token ?? null;
    this.runtimeScopeId = config.runtimeScopeId?.trim() || null;
  }

  /**
   * Update the auth token (e.g., after re-authentication).
   */
  setToken(token: string): void {
    this.token = token;
  }

  setRuntimeScopeId(runtimeScopeId?: string | null): void {
    this.runtimeScopeId = runtimeScopeId?.trim() || null;
  }

  // ─── Discovery ───────────────────────────────────────────────

  /**
   * Fetch the public Agent Card from /.well-known/agent.json.
   * No authentication required.
   */
  async getAgentCard(): Promise<AgentCard> {
    const res = await fetch(`${this.baseUrl}/.well-known/agent.json`);
    if (!res.ok) {
      throw new Error(`Failed to fetch agent card: ${res.status}`);
    }
    return res.json();
  }

  /**
   * Fetch the extended Agent Card from /a2a/agent.
   * Includes user-specific data when authenticated.
   */
  async getExtendedAgentCard(): Promise<ExtendedAgentCard> {
    const res = await fetch(`${this.baseUrl}/a2a/agent`, {
      headers: this.buildHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch extended agent card: ${res.status}`);
    }
    return res.json();
  }

  // ─── Messaging ───────────────────────────────────────────────

  /**
   * Send a message (non-streaming). Returns the completed Task.
   *
   * Use `metadata.agentId` to target a specific agent.
   * Use `metadata.taskId` to continue an existing conversation.
   *
   * BYOK note: Store your Anthropic API key via the vault API first
   * (PUT /wallet/apikey). The gateway uses vault-stored keys only —
   * inline metadata keys are rejected.
   */
  async sendMessage(request: SendMessageRequest): Promise<Task> {
    const enrichedRequest = this.enrichRequest(request);
    const res = await fetch(`${this.baseUrl}/a2a/messages`, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(enrichedRequest),
    });

    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    const data: JsonRpcResponse<Task> = await res.json();
    if (data.error) {
      throw new A2AError(data.error);
    }
    return data.result!;
  }

  /**
   * Send a message with SSE streaming. Yields A2A stream events.
   *
   * Events include TaskStatusUpdateEvent (state changes) and
   * TaskArtifactUpdateEvent (content chunks).
   */
  async *sendStreamingMessage(request: SendMessageRequest): AsyncGenerator<StreamEvent> {
    const enrichedRequest = this.enrichRequest(request);
    const res = await fetch(`${this.baseUrl}/a2a/messages:stream`, {
      method: 'POST',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(enrichedRequest),
    });

    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    yield* this.parseSSEStream(res);
  }

  // ─── Task Management ─────────────────────────────────────────

  /**
   * Get a task by ID.
   */
  async getTask(taskId: string): Promise<Task> {
    const res = await fetch(`${this.baseUrl}/a2a/tasks/${encodeURIComponent(taskId)}`, {
      headers: this.buildHeaders(),
    });

    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    const data: JsonRpcResponse<Task> = await res.json();
    if (data.error) {
      throw new A2AError(data.error);
    }
    return data.result!;
  }

  /**
   * List tasks with pageToken pagination.
   */
  async listTasks(options?: ListTasksOptions): Promise<TaskListResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.pageToken) params.set('pageToken', options.pageToken);
    if (options?.contextId) params.set('contextId', options.contextId);
    if (options?.status) params.set('status', options.status);
    if (this.runtimeScopeId) params.set('runtimeScopeId', this.runtimeScopeId);

    const qs = params.toString();
    const res = await fetch(
      `${this.baseUrl}/a2a/tasks${qs ? '?' + qs : ''}`,
      { headers: this.buildHeaders() },
    );

    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    const data: JsonRpcResponse<TaskListResponse> = await res.json();
    if (data.error) {
      throw new A2AError(data.error);
    }
    return data.result!;
  }

  /**
   * Cancel a task.
   */
  async cancelTask(taskId: string): Promise<Task> {
    const res = await fetch(
      `${this.baseUrl}/a2a/tasks/${encodeURIComponent(taskId)}:cancel`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
      },
    );

    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    const data: JsonRpcResponse<Task> = await res.json();
    if (data.error) {
      throw new A2AError(data.error);
    }
    return data.result!;
  }

  /**
   * Subscribe to task updates via SSE.
   * The first event is always the current task state.
   * If the task is in a terminal state, the stream yields one event and ends.
   */
  async *subscribeToTask(taskId: string): AsyncGenerator<StreamEvent> {
    const res = await fetch(
      `${this.baseUrl}/a2a/tasks/${encodeURIComponent(taskId)}:subscribe`,
      { headers: this.buildHeaders() },
    );

    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    yield* this.parseSSEStream(res);
  }

  // ─── API Key Management ──────────────────────────────────────

  /**
   * Store an Anthropic API key in the gateway vault (encrypted in-memory).
   * Enables BYOK mode for this wallet.
   */
  async storeApiKey(apiKey: string): Promise<{ success: boolean; configured: boolean }> {
    const res = await fetch(`${this.baseUrl}/wallet/apikey`, {
      method: 'PUT',
      headers: this.buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ anthropicApiKey: apiKey }),
    });
    if (!res.ok) await this.throwFromResponse(res);
    return res.json();
  }

  /**
   * Check if an Anthropic API key is configured for this wallet.
   */
  async getApiKeyStatus(): Promise<{ configured: boolean }> {
    const res = await fetch(`${this.baseUrl}/wallet/apikey/status`, {
      headers: this.buildHeaders(),
    });
    if (!res.ok) await this.throwFromResponse(res);
    return res.json();
  }

  /**
   * Delete the stored Anthropic API key from the gateway vault.
   * Returns to standard pricing (full LLM cost).
   */
  async deleteApiKey(): Promise<{ success: boolean; configured: boolean }> {
    const res = await fetch(`${this.baseUrl}/wallet/apikey`, {
      method: 'DELETE',
      headers: this.buildHeaders(),
    });
    if (!res.ok) await this.throwFromResponse(res);
    return res.json();
  }

  // ─── SSE Parsing ─────────────────────────────────────────────

  /**
   * Parse an SSE response body into a stream of typed events.
   *
   * Format: `data: {...}\n\n`
   */
  private async *parseSSEStream(response: Response): AsyncGenerator<StreamEvent> {
    const body = response.body;
    if (!body) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (terminated by double newline)
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          // Extract data from SSE line(s)
          const dataLine = extractSSEData(chunk);
          if (dataLine) {
            try {
              const event: StreamEvent = JSON.parse(dataLine);
              yield event;
            } catch {
              // Skip malformed JSON — graceful degradation
            }
          }

          boundary = buffer.indexOf('\n\n');
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        const dataLine = extractSSEData(buffer);
        if (dataLine) {
          try {
            const event: StreamEvent = JSON.parse(dataLine);
            yield event;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      [A2A_VERSION_HEADER]: A2A_VERSION,
      ...extra,
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.runtimeScopeId) {
      headers['X-Runtime-Scope-Id'] = this.runtimeScopeId;
    }
    return headers;
  }

  private enrichRequest(request: SendMessageRequest): SendMessageRequest {
    if (!this.runtimeScopeId) return request;
    const metadata = {
      ...(request.metadata ?? {}),
      runtimeScopeId: this.runtimeScopeId,
    };
    return { ...request, metadata };
  }

  private async throwFromResponse(res: Response): Promise<never> {
    let errorBody: string;
    try {
      errorBody = await res.text();
    } catch {
      errorBody = '';
    }

    // Try to parse as JSON-RPC error
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error) {
        throw new A2AError(parsed.error);
      }
    } catch (e) {
      if (e instanceof A2AError) throw e;
    }

    throw new Error(`A2A request failed: ${res.status} ${errorBody}`);
  }
}
