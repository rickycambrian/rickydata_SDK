import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntelligenceApi } from '../src/services/intelligence-api.js';
import type {
  CommitAnalysis,
  LabelSuggestion,
  IssueRelationship,
  StateContext,
  TriageResult,
  RelationshipType,
} from '../src/types.js';

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe('IntelligenceApi', () => {
  let api: IntelligenceApi;
  const baseUrl = 'https://gateway.example.com';
  const token = 'test-token-123';

  beforeEach(() => {
    api = new IntelligenceApi({
      baseUrl,
      getToken: () => Promise.resolve(token),
    });
  });

  describe('constructor', () => {
    it('strips trailing slash from baseUrl', async () => {
      const apiWithSlash = new IntelligenceApi({
        baseUrl: 'https://example.com/',
        getToken: () => Promise.resolve(undefined),
      });
      const fetchMock = mockFetch({ recentCommits: [], activeAreas: [], recentFeatures: [], openWork: [] });
      globalThis.fetch = fetchMock;
      await apiWithSlash.analyzeCommits('owner/repo');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/api/v1/issues/analyze-commits',
        expect.any(Object),
      );
    });
  });

  describe('analyzeCommits', () => {
    const mockResult: CommitAnalysis = {
      recentCommits: [{ sha: 'abc123', message: 'fix bug', files: ['src/app.ts'], author: 'dev', date: '2026-03-20' }],
      activeAreas: ['src/'],
      recentFeatures: ['auth'],
      openWork: ['refactor logging'],
    };

    it('sends POST with repo', async () => {
      globalThis.fetch = mockFetch(mockResult);
      const result = await api.analyzeCommits('owner/repo');
      expect(result).toEqual(mockResult);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/issues/analyze-commits`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repo: 'owner/repo' }),
        }),
      );
    });

    it('includes limit when provided', async () => {
      globalThis.fetch = mockFetch(mockResult);
      await api.analyzeCommits('owner/repo', 50);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ repo: 'owner/repo', limit: 50 }),
        }),
      );
    });
  });

  describe('suggestLabels', () => {
    const mockLabels: LabelSuggestion[] = [
      { label: 'bug', confidence: 0.9, reason: 'Error mentioned in title' },
    ];

    it('sends repo and issueNumber', async () => {
      globalThis.fetch = mockFetch(mockLabels);
      const result = await api.suggestLabels('owner/repo', 42);
      expect(result).toEqual(mockLabels);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/issues/suggest-labels`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repo: 'owner/repo', issueNumber: 42 }),
        }),
      );
    });
  });

  describe('detectRelationships', () => {
    const mockRelationships: IssueRelationship[] = [
      { fromIssue: 1, toIssue: 2, type: 'blocks', confidence: 0.85, reason: 'Issue 1 must be resolved first' },
    ];

    it('sends repo', async () => {
      globalThis.fetch = mockFetch(mockRelationships);
      const result = await api.detectRelationships('owner/repo');
      expect(result).toEqual(mockRelationships);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/issues/detect-relationships`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repo: 'owner/repo' }),
        }),
      );
    });
  });

  describe('buildContext', () => {
    const mockContext: StateContext = {
      commitAnalysis: { recentCommits: [], activeAreas: [], recentFeatures: [], openWork: [] },
      relatedIssues: [{ number: 10, title: 'Related bug', state: 'open', labels: ['bug'] }],
      suggestedLabels: [],
      relationships: [],
      repoLanguages: { TypeScript: 80, JavaScript: 20 },
      recentPRs: [{ number: 5, title: 'Fix auth', state: 'merged' }],
    };

    it('sends repo and issueNumber', async () => {
      globalThis.fetch = mockFetch(mockContext);
      const result = await api.buildContext('owner/repo', 7);
      expect(result).toEqual(mockContext);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/issues/build-context`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repo: 'owner/repo', issueNumber: 7 }),
        }),
      );
    });
  });

  describe('triage', () => {
    const mockTriage: TriageResult = {
      labelsApplied: ['bug', 'high-priority'],
      relationshipsDetected: [],
      stateContext: {
        commitAnalysis: { recentCommits: [], activeAreas: [], recentFeatures: [], openWork: [] },
        relatedIssues: [],
        suggestedLabels: [],
        relationships: [],
        repoLanguages: {},
        recentPRs: [],
      },
      triageComment: 'Auto-triaged as high-priority bug',
    };

    it('sends repo and issueNumber', async () => {
      globalThis.fetch = mockFetch(mockTriage);
      const result = await api.triage('owner/repo', 15);
      expect(result).toEqual(mockTriage);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `${baseUrl}/api/v1/issues/triage`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repo: 'owner/repo', issueNumber: 15 }),
        }),
      );
    });
  });

  describe('auth headers', () => {
    it('includes Authorization header when token is available', async () => {
      globalThis.fetch = mockFetch([]);
      await api.detectRelationships('owner/repo');
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].headers).toMatchObject({
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      });
    });

    it('omits Authorization header when token is undefined', async () => {
      const noAuthApi = new IntelligenceApi({
        baseUrl,
        getToken: () => Promise.resolve(undefined),
      });
      globalThis.fetch = mockFetch([]);
      await noAuthApi.detectRelationships('owner/repo');
      const callArgs = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1].headers).not.toHaveProperty('Authorization');
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response with body', async () => {
      globalThis.fetch = mockFetch({ error: 'Not found' }, 404);
      await expect(api.suggestLabels('owner/repo', 999)).rejects.toThrow(
        'Intelligence API error 404',
      );
    });

    it('throws on 500 error', async () => {
      globalThis.fetch = mockFetch('Internal error', 500);
      await expect(api.triage('owner/repo', 1)).rejects.toThrow(
        'Intelligence API error 500',
      );
    });
  });

  describe('type compilation', () => {
    it('RelationshipType accepts all valid values', () => {
      const types: RelationshipType[] = ['parent', 'child', 'related', 'blocks', 'blocked_by', 'duplicate'];
      expect(types).toHaveLength(6);
    });
  });
});
