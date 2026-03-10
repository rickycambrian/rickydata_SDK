/**
 * Canvas Workflow Client
 *
 * Authenticated client for executing canvas workflows via the Agent Gateway.
 * Supports SSE streaming via async generators and synchronous execution.
 *
 * Uses AuthManager for authenticated requests (consistent with the rest of the SDK).
 */

import type { AuthManager } from '../auth.js';
import type {
  CanvasWorkflowRequest,
  CanvasSSEEvent,
  CanvasRunState,
  CanvasExecutionResult,
  GeoWorkflow,
} from './types.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';

export interface CanvasClientConfig {
  /** Agent Gateway base URL. Defaults to https://agents.rickydata.org */
  baseUrl?: string;
  /** AuthManager instance for authenticated requests. */
  auth: AuthManager;
  /** Optional runtime scope to attach to workflow runs. */
  runtimeScopeId?: string;
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
   * Usage:
   * ```ts
   * for await (const event of client.executeWorkflow(request)) {
   *   console.log(event.type, event.data);
   * }
   * ```
   */
  async *executeWorkflow(
    request: CanvasWorkflowRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<CanvasSSEEvent, void, undefined> {
    const url = `${this.baseUrl}/canvas/workflows/execute/stream`;
    const payload = this.runtimeScopeId && !request.runtimeScopeId
      ? { ...request, runtimeScopeId: this.runtimeScopeId }
      : request;

    const res = await this.auth.fetchWithAuth(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Canvas workflow execution failed: ${res.status} ${body}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body from canvas workflow execution');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
      onEvent?: (event: CanvasSSEEvent) => void;
    },
  ): Promise<CanvasExecutionResult> {
    const events: CanvasSSEEvent[] = [];
    let runId = '';
    let status: CanvasExecutionResult['status'] = 'running';
    let results: Record<string, unknown> = {};
    let logs: string[] = [];

    for await (const event of this.executeWorkflow(request, options?.signal)) {
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
      throw new Error(`Failed to list canvas runs: ${res.status} ${body}`);
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
      throw new Error(`Failed to get canvas run: ${res.status} ${body}`);
    }

    return res.json();
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
      throw new Error(`Failed to ${decision} gate: ${res.status} ${body}`);
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
      throw new Error(`Failed to save workflow: ${res.status} ${body}`);
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
      throw new Error(`Failed to list workflows: ${res.status} ${body}`);
    }

    const data = await res.json();
    return data.workflows ?? [];
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
