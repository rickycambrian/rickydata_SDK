import type { AuthManager } from '../auth.js';
import type { CanvasConnection, CanvasNode } from '../canvas/types.js';
import type {
  CreatePixelAgentSessionRequest,
  PixelClientConfig,
  PixelEvent,
  PixelGitHubTeammate,
  PixelGitHubWorktreeRequest,
  PixelSessionDescriptor,
  PixelWalletStatus,
  PixelWorkflowRequest,
  StreamPixelAgentSessionRequest,
  CanvasRunState,
} from './types.js';
import { extractSSEData } from '../agent/index.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';

function slugifyBranchPart(value: string): string {
  const collapsed = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return collapsed || 'task';
}

export function buildGitHubWorktreeWorkflow(request: PixelGitHubWorktreeRequest): PixelWorkflowRequest {
  const repo = request.repoFullName.trim();
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('repoFullName must be in "owner/repo" format');
  }

  const [owner, repoName] = parts;
  const baseBranch = request.baseBranch?.trim() || 'main';
  const branchName = request.branchName?.trim()
    || `${request.branchPrefix?.trim() || 'pixel'}/${slugifyBranchPart(request.prompt).slice(0, 48)}`;
  const teammates: PixelGitHubTeammate[] = request.teammates?.length
    ? request.teammates
    : [{ teammateName: 'implementer', rolePrompt: 'Implement the requested GitHub change carefully.' }];

  const nodes: CanvasNode[] = [
    { id: 'prompt', type: 'text-input', data: { value: request.prompt } },
    { id: 'repo', type: 'github-repo', data: { owner, repo: repoName, repoFullName: repo } },
    { id: 'gate', type: 'approval-gate', data: { message: 'Approve repository write access for this run.' } },
    { id: 'branch', type: 'github-create-branch', data: { branchName, baseBranch } },
    {
      id: 'team',
      type: 'agent-team-orchestrator',
      data: {
        teamName: request.teamName?.trim() || `${repoName} delivery team`,
        executionMode: 'github_worktree',
      },
    },
    {
      id: 'commit',
      type: 'github-commit-files',
      data: {
        consumeUpstream: true,
        message: `pixel office: ${request.prompt}`.slice(0, 180),
      },
    },
    ...(request.openPullRequest === false
      ? [{ id: 'results', type: 'results', data: {} } satisfies CanvasNode]
      : [
        {
          id: 'pr',
          type: 'github-open-draft-pr',
          data: {
            base: baseBranch,
            title: `Pixel Office: ${request.prompt}`.slice(0, 120),
          },
        } satisfies CanvasNode,
        { id: 'results', type: 'results', data: {} } satisfies CanvasNode,
      ]),
  ];

  const connections: CanvasConnection[] = [
    { source: 'prompt', target: 'team' },
    { source: 'repo', target: 'gate' },
    { source: 'repo', target: 'branch' },
    { source: 'gate', target: 'branch' },
    { source: 'branch', target: 'team' },
    { source: 'team', target: 'commit' },
    ...(request.openPullRequest === false
      ? [{ source: 'commit', target: 'results' }]
      : [
        { source: 'commit', target: 'pr' },
        { source: 'pr', target: 'results' },
      ]),
  ];

  return {
    nodes,
    connections,
    runtime: {
      mode: request.runtime?.mode ?? 'write_candidate',
      allowAgentFallback: request.runtime?.allowAgentFallback ?? true,
      ...(typeof request.runtime?.autoApprove === 'boolean' ? { autoApprove: request.runtime.autoApprove } : {}),
    },
    teamRuntime: {
      teammates: teammates.map((teammate, index) => ({
        nodeId: teammate.nodeId ?? `runtime-teammate-${index + 1}`,
        teammateName: teammate.teammateName,
        sourceType: teammate.sourceType ?? 'standard',
        ...(teammate.sourceAgentId ? { sourceAgentId: teammate.sourceAgentId } : {}),
        ...(teammate.rolePrompt ? { rolePrompt: teammate.rolePrompt } : {}),
        ...(teammate.model ? { model: teammate.model } : {}),
        ...(teammate.allowedServers ? { allowedServers: teammate.allowedServers } : {}),
        ...(teammate.tools ? { tools: teammate.tools } : {}),
        ...(typeof teammate.maxTurns === 'number' ? { maxTurns: teammate.maxTurns } : {}),
      })),
    },
  };
}

export class PixelClient {
  private readonly baseUrl: string;
  private readonly auth: AuthManager;

  constructor(config: PixelClientConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    this.auth = config.auth;
  }

  async listAgents(): Promise<Array<{
    id: string;
    name: string;
    title?: string;
    description?: string;
    model?: string;
    source?: string;
    mcpServers?: string[];
  }>> {
    const res = await fetch(`${this.baseUrl}/agents`);
    if (!res.ok) {
      throw new Error(`Failed to list agents: ${res.status}`);
    }
    const data = await res.json();
    return data.agents ?? [];
  }

  async createAgentSession(
    agentId: string,
    request?: CreatePixelAgentSessionRequest,
  ): Promise<PixelSessionDescriptor> {
    if (!agentId) throw new Error('agentId is required');
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/pixel/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request ?? {}),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create Pixel session: ${res.status} ${body}`);
    }

    return res.json();
  }

  async *streamAgentSession(
    agentId: string,
    sessionId: string,
    request: StreamPixelAgentSessionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<PixelEvent, void, undefined> {
    if (!agentId) throw new Error('agentId is required');
    if (!sessionId) throw new Error('sessionId is required');
    if (!request?.message) throw new Error('message is required');

    const res = await this.auth.fetchWithAuth(
      `${this.baseUrl}/pixel/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to stream Pixel session: ${res.status} ${body}`);
    }

    yield* this.parseSSE(res);
  }

  async *streamWorkflow(
    request: PixelWorkflowRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<PixelEvent, void, undefined> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/pixel/workflows/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to stream Pixel workflow: ${res.status} ${body}`);
    }

    yield* this.parseSSE(res);
  }

  async *streamGitHubWorktree(
    request: PixelGitHubWorktreeRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<PixelEvent, void, undefined> {
    yield* this.streamWorkflow(buildGitHubWorktreeWorkflow(request), signal);
  }

  async approveRun(
    runId: string,
    approvalId: string,
    decision: 'approve' | 'reject' = 'approve',
    reason?: string,
  ): Promise<void> {
    const res = await this.auth.fetchWithAuth(
      `${this.baseUrl}/pixel/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to ${decision} Pixel approval: ${res.status} ${body}`);
    }
  }

  async getRun(runId: string): Promise<CanvasRunState> {
    const res = await this.auth.fetchWithAuth(`${this.baseUrl}/pixel/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to get Pixel run: ${res.status} ${body}`);
    }
    return res.json();
  }

  async getWalletStatus(): Promise<PixelWalletStatus> {
    const [balanceRes, byokRes] = await Promise.all([
      this.auth.fetchWithAuth(`${this.baseUrl}/wallet/balance`),
      this.auth.fetchWithAuth(`${this.baseUrl}/wallet/apikey/status`),
    ]);

    if (!balanceRes.ok) {
      const body = await balanceRes.text();
      throw new Error(`Failed to fetch wallet balance: ${balanceRes.status} ${body}`);
    }
    if (!byokRes.ok) {
      const body = await byokRes.text();
      throw new Error(`Failed to fetch BYOK status: ${byokRes.status} ${body}`);
    }

    return {
      balance: await balanceRes.json(),
      byok: await byokRes.json(),
    };
  }

  private async *parseSSE(res: Response): AsyncGenerator<PixelEvent, void, undefined> {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No response body available for Pixel stream');
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
            try {
              const event = JSON.parse(dataLine) as PixelEvent;
              yield event;
            } catch {
              // Ignore malformed SSE payloads.
            }
          }

          boundary = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim()) {
        const dataLine = extractSSEData(buffer);
        if (dataLine) {
          try {
            yield JSON.parse(dataLine) as PixelEvent;
          } catch {
            // Ignore malformed trailing SSE payloads.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
