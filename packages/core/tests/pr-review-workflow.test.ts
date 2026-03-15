import { describe, it, expect } from 'vitest';
import { buildPRReviewWorkflow } from '../src/canvas/pr-review-workflow.js';
import type { PRReviewWorkflowInput, PRReviewRole } from '../src/canvas/pr-review-workflow.js';

function makeInput(overrides: Partial<PRReviewWorkflowInput> = {}): PRReviewWorkflowInput {
  return {
    owner: 'acme',
    repo: 'app',
    prNumber: 42,
    diff: '--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new',
    ...overrides,
  };
}

const ALL_ROLES: PRReviewRole[] = [
  'security',
  'correctness',
  'performance',
  'test_coverage',
  'style',
  'architecture',
];

describe('buildPRReviewWorkflow', () => {
  // ─── Default config (all 6 agents) ──────────────────────

  it('produces all 6 teammate entries by default', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const teammates = (workflow.teamRuntime as { teammates: unknown[] }).teammates;

    expect(teammates).toHaveLength(6);
    const names = (teammates as { teammateName: string }[]).map(t => t.teammateName);
    expect(names).toEqual(ALL_ROLES);
  });

  it('includes text-input, orchestrator, and results nodes by default', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const nodes = workflow.nodes as { id: string; type: string }[];

    expect(nodes).toHaveLength(3);
    expect(nodes.map(n => n.type)).toEqual(['text-input', 'agent-team-orchestrator', 'results']);
  });

  it('has 2 connections in direct mode by default', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const connections = workflow.connections as { source: string; target: string }[];

    expect(connections).toHaveLength(2);
    expect(connections[0]).toEqual({ source: 'text-input-1', target: 'agent-team-orchestrator-1' });
    expect(connections[1]).toEqual({ source: 'agent-team-orchestrator-1', target: 'results-1' });
  });

  // ─── Subset of agents ───────────────────────────────────

  it('uses only specified agents when config.agents is set', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { agents: ['security', 'correctness'] } }),
    );
    const teammates = (workflow.teamRuntime as { teammates: { teammateName: string }[] }).teammates;

    expect(teammates).toHaveLength(2);
    expect(teammates[0].teammateName).toBe('security');
    expect(teammates[1].teammateName).toBe('correctness');
  });

  // ─── Direct mode ────────────────────────────────────────

  it('embeds the diff in text-input node value in direct mode', () => {
    const diff = '+added line\n-removed line';
    const workflow = buildPRReviewWorkflow(makeInput({ diff }));
    const nodes = workflow.nodes as { id: string; type: string; data: { value?: string } }[];
    const textNode = nodes.find(n => n.type === 'text-input')!;

    expect(textNode.data.value).toContain(diff);
    expect(textNode.data.value).toContain('acme/app#42');
  });

  it('does not include a github-repo node in direct mode', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const nodes = workflow.nodes as { type: string }[];

    expect(nodes.some(n => n.type === 'github-repo')).toBe(false);
  });

  // ─── github-repo mode ──────────────────────────────────

  it('includes a github-repo node in github-repo mode', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { mode: 'github-repo' } }),
    );
    const nodes = workflow.nodes as { id: string; type: string; data: Record<string, unknown> }[];
    const repoNode = nodes.find(n => n.type === 'github-repo');

    expect(repoNode).toBeDefined();
    expect(repoNode!.data.owner).toBe('acme');
    expect(repoNode!.data.repo).toBe('app');
  });

  it('adds an extra connection from github-repo to orchestrator', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { mode: 'github-repo' } }),
    );
    const connections = workflow.connections as { source: string; target: string }[];

    expect(connections).toHaveLength(3);
    expect(connections).toContainEqual({
      source: 'github-repo-1',
      target: 'agent-team-orchestrator-1',
    });
  });

  it('has 4 nodes in github-repo mode', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { mode: 'github-repo' } }),
    );
    const nodes = workflow.nodes as { type: string }[];

    expect(nodes).toHaveLength(4);
    expect(nodes.map(n => n.type)).toContain('github-repo');
  });

  // ─── Custom model ───────────────────────────────────────

  it('propagates custom model to orchestrator and all teammates', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { model: 'opus' } }),
    );

    const nodes = workflow.nodes as { type: string; data: { model?: string } }[];
    const orchestrator = nodes.find(n => n.type === 'agent-team-orchestrator')!;
    expect(orchestrator.data.model).toBe('opus');

    const teammates = (workflow.teamRuntime as { teammates: { model: string }[] }).teammates;
    for (const t of teammates) {
      expect(t.model).toBe('opus');
    }
  });

  it('defaults model to sonnet', () => {
    const workflow = buildPRReviewWorkflow(makeInput());

    const nodes = workflow.nodes as { type: string; data: { model?: string } }[];
    const orchestrator = nodes.find(n => n.type === 'agent-team-orchestrator')!;
    expect(orchestrator.data.model).toBe('sonnet');
  });

  it('allows per-agent model overrides', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { model: 'sonnet', perAgentModel: { security: 'opus' } } }),
    );
    const teammates = (workflow.teamRuntime as { teammates: { teammateName: string; model: string }[] }).teammates;
    const securityAgent = teammates.find(t => t.teammateName === 'security')!;
    const styleAgent = teammates.find(t => t.teammateName === 'style')!;

    expect(securityAgent.model).toBe('opus');
    expect(styleAgent.model).toBe('sonnet');
  });

  // ─── Team name ──────────────────────────────────────────

  it('generates a team name from owner, repo, and PR number', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const runtime = workflow.teamRuntime as { orchestratorNodeId: string };

    expect(runtime.orchestratorNodeId).toBe('agent-team-orchestrator-1');
  });

  // ─── Review context (reviewMd) ──────────────────────────

  it('appends reviewMd to the text-input value', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ reviewMd: 'Focus on auth changes' }),
    );
    const nodes = workflow.nodes as { type: string; data: { value?: string } }[];
    const textNode = nodes.find(n => n.type === 'text-input')!;

    expect(textNode.data.value).toContain('Focus on auth changes');
    expect(textNode.data.value).toContain('Review context:');
  });

  it('does not include review context section when reviewMd is absent', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const nodes = workflow.nodes as { type: string; data: { value?: string } }[];
    const textNode = nodes.find(n => n.type === 'text-input')!;

    expect(textNode.data.value).not.toContain('Review context:');
  });

  // ─── maxFindingsPerAgent ────────────────────────────────

  it('appends findings limit to role prompts when maxFindingsPerAgent is set', () => {
    const workflow = buildPRReviewWorkflow(
      makeInput({ config: { maxFindingsPerAgent: 5 } }),
    );
    const teammates = (workflow.teamRuntime as { teammates: { rolePrompt: string }[] }).teammates;

    for (const t of teammates) {
      expect(t.rolePrompt).toContain('Limit output to 5 most important findings');
    }
  });

  it('does not append findings limit when maxFindingsPerAgent is not set', () => {
    const workflow = buildPRReviewWorkflow(makeInput());
    const teammates = (workflow.teamRuntime as { teammates: { rolePrompt: string }[] }).teammates;

    for (const t of teammates) {
      expect(t.rolePrompt).not.toContain('Limit output to');
    }
  });
});
