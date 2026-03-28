import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SelfImprovementClient } from '../src/research/self-improvement-client.js';
import type { ResearchPrivacyContext, SkillCandidate } from '../src/research/types.js';

const BASE = 'https://agents.rickydata.org';

const privacyContext: ResearchPrivacyContext = {
  walletAddress: '0x75992f829df3b5d515d70db0f77a98171ce261ef',
  projectId: 'project-123',
  workspaceId: 'workspace-456',
  visibility: 'private',
  readScope: 'private',
  allowGlobalInputs: false,
};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

const candidate: SkillCandidate = {
  id: 'cand-1',
  name: 'bash-read-recovery',
  title: 'Bash retry recovery',
  description: 'Use when Bash keeps failing with timeout.',
  stage: 'wallet_candidate',
  privacyContext,
  signature: {
    id: 'sig-1',
    frictionType: 'tool_retry_loop',
    failingTool: 'Bash',
    resolutionTool: 'Read',
    errorTypes: ['timeout'],
    triggerLabel: 'tool retry loop via Bash',
    supportCount: 2,
  },
  trigger: {
    whenToUse: 'Bash keeps failing with timeout',
    doNotUse: 'Do not use when Bash is already succeeding',
    failureSignatures: ['tool retry loop episode', 'timeout'],
    correctToolCallPattern: ['Detect the retry loop', 'Switch to Read'],
  },
  evidenceBundle: {
    traceEpisodeIds: ['trace-1', 'trace-2'],
    sampleSize: 2,
    successfulRecoveries: 2,
    repoCount: 1,
    evidence: ['session-1 recovered after switching to Read'],
    sourceRefs: ['local_jsonl:session-1'],
  },
  skillMarkdown: '---\nname: bash-read-recovery\ndescription: Use when Bash keeps failing with timeout.\n---\n',
  claudeRouterEntry: '- Load `bash-read-recovery` when Bash keeps failing with timeout.',
  provider: 'minimax',
  model: 'MiniMax-M2.7',
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
};

describe('SelfImprovementClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gets self-improvement status with Bearer auth', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ running: false }));

    const client = new SelfImprovementClient({ baseUrl: BASE, token: 'mcpwt_token' });
    const result = await client.getStatus();

    expect(result.running).toBe(false);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/wallet/self-improvement/status`);
    expect((init?.headers as Headers).get('authorization')).toBe('Bearer mcpwt_token');
  });

  it('lists wallet skills through the wallet API surface', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ skills: [], total: 0 }));

    const client = new SelfImprovementClient({ baseUrl: BASE, token: 'mcpwt_token' });
    await client.listWalletSkills();

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/wallet/skills`);
  });

  it('upserts wallet skills through PUT /wallet/skills/:name', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ success: true }));

    const client = new SelfImprovementClient({ baseUrl: BASE, token: 'mcpwt_token' });
    await client.upsertWalletSkill('bash-read-recovery', candidate.skillMarkdown);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/wallet/skills/bash-read-recovery`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ content: candidate.skillMarkdown });
  });

  it('creates and lists skill candidates through the research API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse(candidate))
      .mockResolvedValueOnce(okResponse({ items: [candidate], total: 1 }));

    const client = new SelfImprovementClient({ baseUrl: BASE, token: 'mcpwt_token' });
    const created = await client.createSkillCandidate(candidate);
    const listed = await client.listSkillCandidates({ projectId: privacyContext.projectId, stage: 'wallet_candidate' });

    expect(created.id).toBe('cand-1');
    expect(listed.total).toBe(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/research/skill-candidates`);
    expect(fetchSpy.mock.calls[1][0]).toBe(
      `${BASE}/api/v1/research/skill-candidates?projectId=project-123&stage=wallet_candidate`,
    );
  });

  it('backtests and promotes candidates with typed payloads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ ...candidate, stage: 'wallet_candidate' }))
      .mockResolvedValueOnce(okResponse({ ...candidate, stage: 'wallet_validated' }));

    const client = new SelfImprovementClient({ baseUrl: BASE, token: 'mcpwt_token' });
    await client.backtestSkillCandidate('cand-1', {
      backtest: {
        candidateId: 'cand-1',
        totalEpisodes: 3,
        matchedEpisodes: 3,
        successfulMatches: 2,
        coverageRate: 1,
        consistencyRate: 0.6667,
        beforeAvgToolCalls: 5,
        afterExpectedToolCalls: 3,
        estimatedToolCallsSaved: 2,
        verdict: 'positive',
        createdAt: '2026-03-28T00:00:00.000Z',
      },
    });
    const promoted = await client.promoteSkillCandidate('cand-1', {
      decision: {
        candidateId: 'cand-1',
        fromStage: 'wallet_candidate',
        toStage: 'wallet_validated',
        decision: 'validate_wallet',
        rationale: 'Positive backtest',
        requiresHumanReview: false,
        createdAt: '2026-03-28T00:00:00.000Z',
      },
    });

    expect(promoted.stage).toBe('wallet_validated');
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/v1/research/skill-candidates/cand-1/backtest`);
    expect(fetchSpy.mock.calls[1][0]).toBe(`${BASE}/api/v1/research/skill-candidates/cand-1/promote`);
  });
});
