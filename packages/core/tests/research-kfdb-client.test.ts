import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchKFDBClient } from '../src/research/kfdb-research-client.js';
import type { ResearchPrivacyContext } from '../src/research/types.js';

const BASE = 'https://kfdb.rickydata.org';

const privacyContext: ResearchPrivacyContext = {
  walletAddress: '0x75992f829df3b5d515d70db0f77a98171ce261ef',
  projectId: 'project-123',
  workspaceId: 'workspace-456',
  visibility: 'private',
  readScope: 'private',
  allowGlobalInputs: false,
};

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('ResearchKFDBClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults all reads to private scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ labels: [{ label: 'ResearchRun', count: 2 }], count: 1 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new ResearchKFDBClient({
      baseUrl: BASE,
      token: 'mcpwt_example',
      privacyContext,
    });
    await client.listLabels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/entities/labels?scope=private`);
  });

  it('requires projectId and workspaceId in privacy context', () => {
    expect(() => new ResearchKFDBClient({
      baseUrl: BASE,
      token: 'mcpwt_example',
      privacyContext: {
        ...privacyContext,
        projectId: '',
      },
    })).toThrow('privacyContext.projectId is required');
  });

  it('rejects unfiltered session queries', () => {
    const client = new ResearchKFDBClient({
      baseUrl: BASE,
      token: 'mcpwt_example',
      privacyContext,
    });

    expect(() => client.validateSessionQuery(
      'SELECT * FROM plugin_sessions ORDER BY started_at DESC LIMIT 10',
    )).toThrow('workspace_id filters');
  });

  it('accepts session queries filtered to the current workspace', () => {
    const client = new ResearchKFDBClient({
      baseUrl: BASE,
      token: 'mcpwt_example',
      privacyContext,
    });

    const sql = `SELECT * FROM plugin_sessions WHERE workspace_id = '${privacyContext.workspaceId}'`;
    expect(client.validateSessionQuery(sql)).toBe(sql);
  });

  it('writes research nodes with private metadata attached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 1, execution_time_ms: 4, affected_ids: ['run-1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new ResearchKFDBClient({
      baseUrl: BASE,
      token: 'mcpwt_example',
      privacyContext,
    });

    await client.write({
      label: 'ResearchRun',
      properties: { title: 'MiniMax private replay' },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.operations[0].label).toBe('ResearchRun');
    expect(body.operations[0].properties.project_id).toBe('project-123');
    expect(body.operations[0].properties.workspace_id).toBe('workspace-456');
    expect(body.operations[0].properties.visibility).toBe('private');
  });

  it('snapshots public inputs into the private tenant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 1, execution_time_ms: 2, affected_ids: ['snapshot-1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new ResearchKFDBClient({
      baseUrl: BASE,
      token: 'mcpwt_example',
      privacyContext,
    });

    await client.snapshotPublicInput({
      snapshot: {
        id: 'snapshot-1',
        sourceType: 'github_issue',
        sourceRef: 'owner/repo#42',
        capturedAt: '2026-03-28T00:00:00.000Z',
        visibility: 'private',
        scope: 'private',
      },
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.operations[0].label).toBe('PublicInputSnapshot');
    expect(body.operations[0].properties.sourceRef).toBe('owner/repo#42');
    expect(body.operations[0].properties.project_id).toBe('project-123');
  });
});
