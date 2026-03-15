/**
 * Canvas Workflow Client
 *
 * Authenticated client for executing canvas workflows via the Agent Gateway.
 * Supports SSE streaming via async generators and synchronous execution.
 *
 * Uses AuthManager for authenticated requests (consistent with the rest of the SDK).
 */

import type { AuthManager } from '../auth.js';
import { CanvasHttpError } from '../errors/index.js';
import type {
  CanvasWorkflowRequest,
  CanvasSSEEvent,
  CanvasRunState,
  CanvasExecutionResult,
  GeoWorkflow,
} from './types.js';
import { extractSSEData } from '../agent/index.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';

export interface CanvasClientConfig {
  /** Agent Gateway base URL. Defaults to https://agents.rickydata.org */
  baseUrl?: string;
  /** AuthManager instance for authenticated requests. */
  auth: AuthManager;
  /** Optional runtime scope to attach to workflow runs. */
  runtimeScopeId?: string;
}

export interface ExecuteWorkflowOptions {
  /** Caller-provided abort signal. */
  signal?: AbortSignal;
  /** Hard timeout in ms. The stream will abort after this duration. */
  timeoutMs?: number;
  /** Idle timeout in ms. The stream aborts if no data arrives within this window. */
  heartbeatTimeoutMs?: number;
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly auth: AuthManager;
  private runtimeScopeId: string | null;

  constructor(config: CanvasClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    this.auth = config.auth;
    this.runtimeScopeId = config.runtimeScopeId?.trim() || null;
  }

  setRuntimeScopeId(runtimeScopeId?: string | null): void {
    this.runtimeScopeId = runtimeScopeId?.trim() || null;
  }

  // ── Workflow Execution (SSE streaming) ───────────────────────────────────

  /**
   * Execute a canvas workflow and yield SSE events as they arrive.
   *
   * Supports timeout and heartbeat idle detection to prevent infinite hangs
   * when proxies or servers silently drop connections.
   *
   * Usage:
   * ```ts
   * for await (const event of client.executeWorkflow(request, { timeoutMs: 300_000 })) {
   *   console.log(event.type, event.data);
   * }
   * ```
   */
  async *executeWorkflow(
    request: CanvasWorkflowRequest,
    options?: AbortSignal | ExecuteWorkflowOptions,
  ): AsyncGenerator<CanvasSSEEvent, void, undefined> {
    // Normalize options (backward-compatible: bare AbortSignal still accepted)
    const opts: ExecuteWorkflowOptions = options instanceof AbortSignal
      ? { signal: options }
      : (options ?? {});
    const { signal: userSignal, timeoutMs, heartbeatTimeoutMs } = opts;

    // Compose abort controller: user signal + overall timeout + heartbeat
    const controller = new AbortController();

    if (userSignal) {
      if (userSignal.aborted) {
        controller.abort(userSignal.reason);
      } else {
        userSignal.addEventListener(
          'abort',
          () => controller.abort(userSignal.reason),
          { once: true },
        );
      }
    }

    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs != null) {
      overallTimer = setTimeout(
        () => controller.abort(new Error(`Canvas workflow timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }

    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    const resetHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (heartbeatTimeoutMs != null && heartbeatTimeoutMs > 0) {
        heartbeatTimer = setTimeout(
          () => controller.abort(
            new Error(`SSE stream idle for ${heartbeatTimeoutMs}ms (no data received)`),
          ),
          heartbeatTimeoutMs,
        );
      }
    };

    const clearTimers = () => {
      if (overallTimer) clearTimeout(overallTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
    };

    const url = `${this.baseUrl}/canvas/workflows/execute/stream`;
    const payload = this.runtimeScopeId && !request.runtimeScopeId
      ? { ...request, runtimeScopeId: this.runtimeScopeId }
      : request;

    const res = await this.auth.fetchWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      clearTimers();
      const body = await res.text();
      throw new CanvasHttpError(res.status, `Canvas workflow execution failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      clearTimers();
      throw new Error('No response body from canvas workflow execution');
    }

    // Cancel reader when abort fires (defense-in-depth: some environments
    // don't propagate fetch abort to the body stream reader)
    const onAbort = () => { reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', onAbort, { once: true });

    const decoder = new TextDecoder();
    let buffer = '';

    resetHeartbeat();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Check if the stream ended due to an abort (timeout/heartbeat/user cancel)
          if (controller.signal.aborted) {
            const reason = controller.signal.reason;
            throw reason instanceof Error ? reason : new Error(String(reason ?? 'Stream aborted'));
          }
          break;
        }

        resetHeartbeat();
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          const dataLine = extractSSEData(chunk);
          if (dataLine) {
            if (dataLine === '[DONE]') return;
            try {
              const event = JSON.parse(dataLine) as CanvasSSEEvent;
              yield event;
              if (event.type === 'error') return;
            } catch {
              // Skip malformed JSON
            }
          }

          boundary = buffer.indexOf('\n\n');
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const dataLine = extractSSEData(buffer);
        if (dataLine && dataLine !== '[DONE]') {
          try {
            yield JSON.parse(dataLine) as CanvasSSEEvent;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      clearTimers();
      controller.signal.removeEventListener('abort', onAbort);
      reader.releaseLock();
    }
  }

  /**
   * Execute a canvas workflow and wait for the final result.
   *
   * Collects all SSE events and returns the aggregated execution result.
   */
  async executeWorkflowSync(
    request: CanvasWorkflowRequest,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      heartbeatTimeoutMs?: number;
      onEvent?: (event: CanvasSSEEvent) => void;
    },
  ): Promise<CanvasExecutionResult> {
    const events: CanvasSSEEvent[] = [];
    let runId = '';
    let status: CanvasExecutionResult['status'] = 'running';
    let results: Record<string, unknown> = {};
    let logs: string[] = [];

    for await (const event of this.executeWorkflow(request, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
      heartbeatTimeoutMs: options?.heartbeatTimeoutMs,
    })) {
      events.push(event);
      options?.onEvent?.(event);

      switch (event.type) {
        case 'run_started':
          runId = event.data.runId;
          break;
        case 'node_log':
          logs.push(event.data.message);
          break;
        case 'run_completed':
          runId = event.data.runId;
          status = event.data.status;
          results = event.data.results;
          logs = [...logs, ...event.data.logs];
          break;
        case 'run_failed':
          runId = event.data.runId;
          status = event.data.status;
          logs = [...logs, ...event.data.logs];
          break;
        case 'error':
          status = 'failed';
          break;
      }
    }

    return { runId, status, results, logs, events };
  }

  // ── Run Management ─────────────────────────────────────────────────────

  /**
   * List canvas workflow runs for the authenticated wallet.
   */
  async listRuns(): Promise<CanvasRunState[]> {
    const url = `${this.baseUrl}/canvas/runs`;
    const res = await this.auth.fetchWithAuth(url);

    if (!res.ok) {
      const body = await res.text();
      throw new CanvasHttpError(res.status, `Failed to list canvas runs: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.runs ?? [];
  }

  /**
   * Get details of a specific canvas workflow run.
   */
  async getRun(runId: string): Promise<CanvasRunState> {
    if (!runId) throw new Error('runId is required');
    const url = `${this.baseUrl}/canvas/runs/${encodeURIComponent(runId)}`;
    const res = await this.auth.fetchWithAuth(url);

    if (!res.ok) {
      const body = await res.text();
      throw new CanvasHttpError(res.status, `Failed to get canvas run: ${res.status} ${body.slice(0, 200)}`);
    }

    return res.json();
  }

  /**
   * Get run details with retry on 404 (handles DB replication lag).
   * Uses exponential back-off: 200ms → 400ms → 800ms → 1600ms → 5000ms cap.
   */
  async getRunWithRetry(
    runId: string,
    options?: { maxAttempts?: number; initialDelayMs?: number; signal?: AbortSignal },
  ): Promise<CanvasRunState> {
    const maxAttempts = options?.maxAttempts ?? 5;
    const initialDelayMs = options?.initialDelayMs ?? 200;
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.getRun(runId);
      } catch (err: unknown) {
        const is404 = err instanceof CanvasHttpError && err.status === 404;
        const isLast = attempt === maxAttempts;
        if (!is404 || isLast) throw err;
        if (options?.signal?.aborted) throw err;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 5_000);
      }
    }
    throw new Error(`getRun failed after ${maxAttempts} attempts for runId: ${runId}`);
  }

  /**
   * Approve or reject an approval gate in a running workflow.
   */
  async approveGate(
    runId: string,
    approvalId: string,
    decision: 'approve' | 'reject' = 'approve',
  ): Promise<void> {
    if (!runId) throw new Error('runId is required');
    if (!approvalId) throw new Error('approvalId is required');

    const url = `${this.baseUrl}/canvas/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`;
    const res = await this.auth.fetchWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new CanvasHttpError(res.status, `Failed to ${decision} gate: ${res.status} ${body.slice(0, 200)}`);
    }
  }

  // ── Workflow Storage ───────────────────────────────────────────────────

  /**
   * Save a canvas workflow to the gateway.
   */
  async saveWorkflow(workflow: {
    name: string;
    description?: string;
    nodes: unknown[];
    edges: unknown[];
  }): Promise<{ workflowId: string }> {
    const url = `${this.baseUrl}/canvas/workflows`;
    const res = await this.auth.fetchWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new CanvasHttpError(res.status, `Failed to save workflow: ${res.status} ${body.slice(0, 200)}`);
    }

    return res.json();
  }

  /**
   * List saved workflows (from Geo storage).
   */
  async listWorkflows(): Promise<GeoWorkflow[]> {
    const url = `${this.baseUrl}/canvas/workflows`;
    const res = await this.auth.fetchWithAuth(url);

    if (!res.ok) {
      const body = await res.text();
      throw new CanvasHttpError(res.status, `Failed to list workflows: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.workflows ?? [];
  }
}
