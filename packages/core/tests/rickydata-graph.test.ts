import { describe, expect, it, vi } from 'vitest';
import { KFDBClient } from '../src/kfdb/client.js';
import {
  GraphEdgeType,
  GraphEntityKind,
  canonicalizeRickydataRepoRef,
  deriveRickydataGraphEdgeId,
  deriveRickydataGraphId,
  rickydataGraphContract,
  rickydataGraphValue,
  buildRickydataGraphWriteRequest,
} from '../src/kfdb/index.js';

const BASE = 'http://localhost:8080';

function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('Rickydata repo/execution graph SDK helpers', () => {
  it('exports the KFDB graph contract from the core schema', () => {
    const contract = rickydataGraphContract();

    expect(contract.schemaVersion).toBe('rickydata.repo_execution_graph.v1');
    expect(contract.nodeLabels).toContain('Repository');
    expect(contract.nodeLabels).toContain('RickydataRun');
    expect(contract.nodeLabels).toContain('GitHubIssue');
    expect(contract.edgeTypes).toContain('PROVES');
    expect(contract.edgeTypes).toContain('PROJECTED_TO_KFDB');
    expect(contract.idConventions.Repository).toEqual(['canonical_repo_ref']);
    expect(contract.idConventions.File).toEqual(['repo_id', 'commit_sha', 'path', 'content_hash']);
  });

  it('canonicalizes repo refs and derives UUIDv5 IDs compatible with kfdb-core', () => {
    const canonicalRepo = canonicalizeRickydataRepoRef('git@github.com:RickyCambrian/knowledgeflow_db.git');
    const repoId = deriveRickydataGraphId(GraphEntityKind.Repository, [canonicalRepo]);
    const fileId = deriveRickydataGraphId(GraphEntityKind.File, [repoId, 'abc123', 'src/lib.rs', 'sha256:content']);

    expect(canonicalRepo).toBe('github.com/rickycambrian/knowledgeflow_db');
    expect(repoId).toBe('2cdf7ea4-533c-59da-987f-392e6c6996b9');
    expect(fileId).toBe('f45b0284-044c-5ef3-af2f-932f0b7d984a');
    expect(() => deriveRickydataGraphId(GraphEntityKind.File, [repoId, 'abc123', 'src/lib.rs'])).toThrow(
      /expected 4 parts/,
    );
  });

  it('builds idempotent /api/v1/write operations for graph nodes and edges', () => {
    const canonicalRepo = canonicalizeRickydataRepoRef('https://github.com/rickycambrian/knowledgeflow_db.git');
    const repoId = deriveRickydataGraphId(GraphEntityKind.Repository, [canonicalRepo]);
    const runId = deriveRickydataGraphId(GraphEntityKind.RickydataRun, [repoId, 'run-1']);
    const proofId = deriveRickydataGraphId(GraphEntityKind.RickydataProof, [repoId, 'proof-1']);
    const edgeId = deriveRickydataGraphEdgeId(runId, GraphEdgeType.Proves, proofId);

    const request = buildRickydataGraphWriteRequest({
      nodes: [
        {
          kind: GraphEntityKind.Repository,
          idParts: [canonicalRepo],
          properties: { name: rickydataGraphValue('knowledgeflow_db') },
        },
        {
          kind: GraphEntityKind.RickydataRun,
          idParts: [repoId, 'run-1'],
          properties: { status: rickydataGraphValue('passed') },
        },
        {
          kind: GraphEntityKind.RickydataProof,
          idParts: [repoId, 'proof-1'],
          properties: { proof_kind: rickydataGraphValue('test') },
        },
      ],
      edges: [{ from: runId, to: proofId, edgeType: GraphEdgeType.Proves }],
    });

    expect(runId).toBe('d600dc2d-b5ef-55b8-8de4-ce6341791dad');
    expect(proofId).toBe('5b23e840-f52a-544d-8c3e-fc1faeb01417');
    expect(edgeId).toBe('c58425e8-2b45-58e3-90fb-1510e245498c');
    expect(request.skip_embedding).toBe(true);
    expect(request.operations).toHaveLength(4);
    expect(request.operations[0]).toMatchObject({
      operation: 'create_node',
      id: repoId,
      label: 'Repository',
      mode: 'merge',
      properties: {
        name: { String: 'knowledgeflow_db' },
        rickydata_graph_schema_version: { String: 'rickydata.repo_execution_graph.v1' },
        rickydata_graph_kind: { String: 'Repository' },
      },
    });
    expect(request.operations[3]).toMatchObject({
      operation: 'create_edge',
      id: edgeId,
      from: runId,
      to: proofId,
      edge_type: 'PROVES',
    });
  });

  it('writes graph projections through KFDBClient.writeRickydataGraph', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({ operations_executed: 2, execution_time_ms: 3, affected_ids: ['node-1', 'edge-1'] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const repoRef = canonicalizeRickydataRepoRef('https://github.com/rickycambrian/rickydata_SDK.git');
    const repoId = deriveRickydataGraphId(GraphEntityKind.Repository, [repoRef]);
    const issueId = deriveRickydataGraphId(GraphEntityKind.GitHubIssue, [repoId, '7']);
    const client = new KFDBClient({ baseUrl: BASE, token: 'tok_123' });

    await client.writeRickydataGraph({
      nodes: [
        { kind: GraphEntityKind.Repository, idParts: [repoRef] },
        { kind: GraphEntityKind.GitHubIssue, idParts: [repoId, '7'] },
      ],
      edges: [{ from: issueId, to: repoId, edgeType: GraphEdgeType.SupportedBy }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/api/v1/write`);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.skip_embedding).toBe(true);
    expect(body.operations.map((op: { operation: string }) => op.operation)).toEqual([
      'create_node',
      'create_node',
      'create_edge',
    ]);
  });
});
