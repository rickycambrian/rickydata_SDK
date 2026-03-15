/**
 * Canvas workflow builder for multi-agent PR review.
 *
 * Produces a CanvasWorkflowRequest-compatible payload with:
 *   - a text-input node (PR diff + metadata)
 *   - a github-repo node
 *   - an agent-team-orchestrator node
 *   - one agent-team-teammate node per reviewer role
 *   - a results node
 */

export type PRReviewRole =
  | 'security'
  | 'correctness'
  | 'performance'
  | 'test_coverage'
  | 'style'
  | 'architecture';

export interface PRReviewWorkflowInput {
  owner: string;
  repo: string;
  prNumber: number;
  diff: string;
  reviewMd?: string;
  config?: {
    agents?: PRReviewRole[];
    model?: string;
    perAgentModel?: Partial<Record<string, string>>;
    maxFindingsPerAgent?: number;
    /** 'direct' embeds the diff in text-input (no GitHub installation needed). 'github-repo' uses the github-repo node. */
    mode?: 'direct' | 'github-repo';
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

const ROLE_PROMPTS: Record<PRReviewRole, string> = {
  security:
    'Review for security vulnerabilities: injection attacks, auth bypass, exposed secrets, unsafe dependencies, weak crypto. Flag severity as critical/major/minor.',
  correctness:
    'Review for correctness bugs: logic errors, null/undefined handling, edge cases, type mismatches, race conditions. Focus on code that will break at runtime.',
  performance:
    'Review for performance issues: N+1 queries, unnecessary allocations, algorithmic complexity, missing caching, bundle size impact. Quantify impact where possible.',
  test_coverage:
    'Review test coverage: identify missing test cases, untested branches, weak assertions, over-mocking. Suggest specific test scenarios.',
  style:
    'Review code style: naming conventions, file organization, consistency with surrounding codebase, dead code, misleading comments.',
  architecture:
    'Review architecture: coupling, abstraction quality, API surface, breaking changes, separation of concerns. Consider long-term maintainability.',
};

const ORCHESTRATOR_PROMPT =
  'You are coordinating a team of specialized code reviewers analyzing a GitHub PR. ' +
  'Aggregate findings from all agents, deduplicate overlapping issues, and produce a final prioritized list of findings. ' +
  'Each finding must include: severity, category, file, line, title, body, suggestion. ' +
  '\n\nOUTPUT FORMAT: Return a JSON object: ' +
  '{"summary":"one-paragraph summary of review","findings":[{"severity":"critical|major|minor|nit|praise",' +
  '"category":"bug|security|performance|style|test|docs|architecture|other",' +
  '"file":"path/to/file","line":42,"title":"Short title","body":"Detailed explanation",' +
  '"suggestion":"optional code fix"}]}' +
  '\n\nReturn ONLY the JSON object with no other text.';

/**
 * Build a canvas workflow payload for multi-agent PR review.
 */
export function buildPRReviewWorkflow(input: PRReviewWorkflowInput): Record<string, unknown> {
  const { owner, repo, prNumber, diff, reviewMd, config } = input;
  const agents = config?.agents ?? ALL_ROLES;
  const model = config?.model ?? 'sonnet';
  const perAgentModel = config?.perAgentModel ?? {};
  const maxFindings = config?.maxFindingsPerAgent;
  const mode = config?.mode ?? 'direct';

  // ── Nodes ────────────────────────────────────────────────────────────────

  const textInputId = 'text-input-1';
  const githubRepoId = 'github-repo-1';
  const orchestratorId = 'agent-team-orchestrator-1';
  const resultsId = 'results-1';

  let inputValue = `PR: ${owner}/${repo}#${prNumber}\n\n${diff}`;
  if (reviewMd) {
    inputValue += `\n\n---\nReview context:\n${reviewMd}`;
  }

  const teamName = `pr-review-${owner}-${repo}-${prNumber}`;

  const nodes: { id: string; type: string; data: Record<string, unknown> }[] = [
    { id: textInputId, type: 'text-input', data: { value: inputValue } },
    {
      id: orchestratorId,
      type: 'agent-team-orchestrator',
      data: { teamName, prompt: ORCHESTRATOR_PROMPT, model },
    },
    { id: resultsId, type: 'results', data: {} },
  ];

  // Only include github-repo node when mode is 'github-repo'
  if (mode === 'github-repo') {
    nodes.splice(1, 0, { id: githubRepoId, type: 'github-repo', data: { owner, repo } });
  }

  const teammates: {
    nodeId: string;
    teammateName: string;
    sourceType: 'standard';
    model: string;
    rolePrompt: string;
  }[] = [];

  for (const role of agents) {
    const nodeId = `teammate-${role}`;
    let prompt = ROLE_PROMPTS[role];
    if (maxFindings) {
      prompt += ` Limit output to ${maxFindings} most important findings.`;
    }

    teammates.push({
      nodeId,
      teammateName: role,
      sourceType: 'standard',
      model: perAgentModel[role] ?? model,
      rolePrompt: prompt,
    });
  }

  // ── Connections ──────────────────────────────────────────────────────────
  // text-input feeds into orchestrator; github-repo also feeds in when enabled

  const connections = [
    { source: textInputId, target: orchestratorId },
    { source: orchestratorId, target: resultsId },
  ];

  if (mode === 'github-repo') {
    connections.splice(1, 0, { source: githubRepoId, target: orchestratorId });
  }

  // ── Payload ──────────────────────────────────────────────────────────────
  // Teammate nodes are NOT in the nodes array — the server creates them from teamRuntime
  // (matches the pattern in buildTeamWorkflowPayload from agent-client.ts)

  return {
    nodes,
    connections,
    teamRuntime: {
      orchestratorNodeId: orchestratorId,
      teammates,
    },
  };
}
