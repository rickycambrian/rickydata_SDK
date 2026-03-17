/**
 * Automation Client
 *
 * Client for managing event-driven automation rules that trigger LLM
 * operations on graph events. Communicates with the KFDB REST API.
 *
 * Uses native fetch (Node 18+) -- no external dependencies.
 */

import type {
  AutomationClientConfig,
  AutomationRule,
  CreateRuleRequest,
  UpdateRuleRequest,
  RuleResponse,
  ListRulesResponse,
  RuleOperationResponse,
  ExecutionLog,
  ExecutionResponse,
  ExecutionLogsResponse,
} from './types.js';

export class AutomationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AutomationClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  // ── Rules CRUD ────────────────────────────────────────────────────────

  /**
   * Create a new automation rule.
   *
   * The rule will start firing on matching graph events if `is_active` is true.
   */
  async createRule(data: CreateRuleRequest): Promise<AutomationRule> {
    if (!data.name) throw new Error('name is required');
    if (!data.trigger_type) throw new Error('trigger_type is required');
    if (!data.operation_type) throw new Error('operation_type is required');
    if (!data.input_property) throw new Error('input_property is required');

    const res = await this.request('/api/v1/automation/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      await this.throwFromResponse(res, 'create automation rule');
    }

    const body: RuleResponse = await res.json();
    return body.rule;
  }

  /**
   * List all automation rules for the authenticated tenant.
   */
  async listRules(): Promise<AutomationRule[]> {
    const res = await this.request('/api/v1/automation/rules');

    if (!res.ok) {
      await this.throwFromResponse(res, 'list automation rules');
    }

    const body: ListRulesResponse = await res.json();
    return body.rules;
  }

  /**
   * Get a specific automation rule by ID.
   */
  async getRule(ruleId: string): Promise<AutomationRule> {
    if (!ruleId) throw new Error('ruleId is required');

    const res = await this.request(
      `/api/v1/automation/rules/${encodeURIComponent(ruleId)}`,
    );

    if (!res.ok) {
      await this.throwFromResponse(res, 'get automation rule');
    }

    const body: RuleResponse = await res.json();
    return body.rule;
  }

  /**
   * Update an existing automation rule (partial update).
   *
   * Only provided fields are changed; omitted fields keep their current values.
   */
  async updateRule(ruleId: string, data: UpdateRuleRequest): Promise<AutomationRule> {
    if (!ruleId) throw new Error('ruleId is required');

    const res = await this.request(
      `/api/v1/automation/rules/${encodeURIComponent(ruleId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
    );

    if (!res.ok) {
      await this.throwFromResponse(res, 'update automation rule');
    }

    const body: RuleResponse = await res.json();
    return body.rule;
  }

  /**
   * Delete an automation rule.
   *
   * Returns confirmation with the deleted rule ID.
   */
  async deleteRule(ruleId: string): Promise<RuleOperationResponse> {
    if (!ruleId) throw new Error('ruleId is required');

    const res = await this.request(
      `/api/v1/automation/rules/${encodeURIComponent(ruleId)}`,
      { method: 'DELETE' },
    );

    if (!res.ok) {
      await this.throwFromResponse(res, 'delete automation rule');
    }

    return res.json();
  }

  // ── Execution Logs ──────────────────────────────────────────────────

  /**
   * List execution logs for the authenticated tenant.
   *
   * @param options.limit - Maximum number of logs to return (default: 100)
   */
  async listExecutions(options?: { limit?: number }): Promise<ExecutionLog[]> {
    const params = new URLSearchParams();
    if (options?.limit != null) params.set('limit', String(options.limit));

    const qs = params.toString();
    const res = await this.request(
      `/api/v1/automation/executions${qs ? '?' + qs : ''}`,
    );

    if (!res.ok) {
      await this.throwFromResponse(res, 'list execution logs');
    }

    const body: ExecutionLogsResponse = await res.json();
    return body.logs;
  }

  /**
   * Get a specific execution log by ID.
   */
  async getExecution(executionId: string): Promise<ExecutionLog> {
    if (!executionId) throw new Error('executionId is required');

    const res = await this.request(
      `/api/v1/automation/executions/${encodeURIComponent(executionId)}`,
    );

    if (!res.ok) {
      await this.throwFromResponse(res, 'get execution log');
    }

    const body: ExecutionResponse = await res.json();
    if (!body.log) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    return body.log;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-KF-API-Key': this.apiKey,
      ...(init?.headers as Record<string, string> || {}),
    };

    return globalThis.fetch(url, {
      ...init,
      headers,
    });
  }

  private async throwFromResponse(res: Response, action: string): Promise<never> {
    let errorBody: string;
    try {
      errorBody = await res.text();
    } catch {
      errorBody = '';
    }

    throw new Error(`Failed to ${action}: ${res.status} ${errorBody}`);
  }
}
