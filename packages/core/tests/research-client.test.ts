import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchClient } from '../src/research/research-client.js';
import type { ResearchPrivacyContext } from '../src/research/types.js';

const BASE = 'https://agents.rickydata.org';

const privacyContext: ResearchPrivacyContext = {
  walletAddress: '0x75992f829df3b5d515d70db0f77a98171ce261ef',
  projectId: 'project-123',
  workspaceId: 'workspace-456',
  visibility: 'private',
  readScope: 'private',
  allowGlobalInputs: true,
};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe('ResearchClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a run with Bearer auth and MiniMax defaults', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({
      id: 'run-1',
      title: 'Replay H010',
      hypothesis: 'MiniMax verify loop improves verifier acceptance',
      status: 'registered',
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      privacyContext,
      agentSpecs: [],
      policyArms: [],
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
    }));

    const client = new ResearchClient({ baseUrl: BASE, token: 'mcpwt_token' });
    const result = await client.createRun({
      title: 'Replay H010',
      hypothesis: 'MiniMax verify loop improves verifier acceptance',
      privacyContext,
    });

    expect(result.provider).toBe('minimax');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/research/runs`);
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get('authorization')).toBe('Bearer mcpwt_token');

    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('MiniMax-M2.7');
    expect(body.agentSpecs).toBeDefined();
    expect(body.policyArms).toBeDefined();
  });

  it('rejects non-private privacy contexts before sending', async () => {
    const client = new ResearchClient({ baseUrl: BASE, token: 'mcpwt_token' });
    await expect(client.createRun({
      title: 'Bad run',
      hypothesis: 'Should fail',
      privacyContext: {
        ...privacyContext,
        readScope: 'private',
        visibility: 'private',
        projectId: '',
      },
    })).rejects.toThrow('privacyContext.projectId is required');
  });

  it('lists runs with query parameters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ items: [], total: 0 }));

    const client = new ResearchClient({ baseUrl: BASE, apiKey: 'internal-key' });
    await client.listRuns({ projectId: 'project-123', workspaceId: 'workspace-456', status: 'running', limit: 5 });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      `${BASE}/api/v1/research/runs?projectId=project-123&workspaceId=workspace-456&status=running&limit=5`,
    );
  });

  it('appends run events to the dedicated endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({
      id: 'evt-1',
      type: 'trace_mined',
      createdAt: '2026-03-28T00:00:00.000Z',
      summary: 'Trace miner completed',
    }));

    const client = new ResearchClient({ baseUrl: BASE, token: 'mcpwt_token' });
    const result = await client.appendRunEvent('run-1', {
      type: 'trace_mined',
      summary: 'Trace miner completed',
    });

    expect(result.id).toBe('evt-1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/research/runs/run-1/events`);
    expect(init?.method).toBe('POST');
  });

  it('drafts research issues through the escalation endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({
      id: 'issue-1',
      status: 'draft',
      mode: 'draft_only',
      repo: 'owner/repo',
      title: 'Repeated verifier friction',
      body: 'Draft body',
      findingIds: ['finding-1'],
      verifierApproved: true,
      sanitizationStatus: 'clean',
      privacyContext,
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
    }));

    const client = new ResearchClient({ baseUrl: BASE, token: 'mcpwt_token' });
    const result = await client.draftIssue({
      privacyContext,
      repo: 'owner/repo',
      finding: {
        title: 'Repeated verifier friction',
        summary: 'The verifier repeatedly flags the same routing bug.',
        sourceType: 'verifier_finding',
        component: 'agent-gateway',
        severity: 'high',
        verifierApproved: true,
      },
    });

    expect(result.status).toBe('draft');
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/research/issues/draft`);
  });
});
