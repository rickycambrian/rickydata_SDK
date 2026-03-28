import type {
  ResearchAgentCatalog,
  ResearchAgentSpec,
  ResearchPolicyArm,
  ResearchPrivacyContext,
} from './types.js';

export const DEFAULT_RESEARCH_PROVIDER = 'minimax' as const;
export const DEFAULT_RESEARCH_MODEL = 'MiniMax-M2.7' as const;

const JSON_SCHEMA_OBJECT = {
  type: 'object',
  required: ['summary'],
  properties: {
    summary: { type: 'string' },
  },
} as const;

export const DEFAULT_RESEARCH_AGENT_SPECS: ResearchAgentSpec[] = [
  {
    id: 'trace-miner',
    name: 'Trace Miner',
    description: 'Private-by-default trace mining agent for extracting candidate patterns from session and benchmark traces.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['kfdb_query_private', 'session_trace_reader', 'benchmark_history_reader'],
    toolPriority: ['kfdb_query_private', 'session_trace_reader', 'benchmark_history_reader'],
    setupRequirements: ['privacy_context', 'workspace_filter', 'project_filter'],
    workflowStages: ['read-private-traces', 'extract-patterns', 'emit-candidates'],
    outputSchema: JSON_SCHEMA_OBJECT,
    abstentionConditions: ['missing workspace filter', 'insufficient trace volume', 'conflicting source traces'],
    verificationHooks: ['candidate-sample-check'],
    bannedTools: ['public_session_query', 'raw_shell_network'],
    repoContextAllowed: false,
    liveFetchRequired: false,
  },
  {
    id: 'hypothesis-generator',
    name: 'Hypothesis Generator',
    description: 'Transforms mined patterns into preregistered hypotheses with explicit null hypotheses and success criteria.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['pattern_reader', 'research_memory_reader'],
    toolPriority: ['pattern_reader', 'research_memory_reader'],
    setupRequirements: ['privacy_context'],
    workflowStages: ['read-patterns', 'preregister-hypothesis', 'score-risk'],
    outputSchema: {
      type: 'object',
      required: ['title', 'hypothesis', 'nullHypothesis', 'successCriteria'],
      properties: {
        title: { type: 'string' },
        hypothesis: { type: 'string' },
        nullHypothesis: { type: 'string' },
        successCriteria: { type: 'array', items: { type: 'string' } },
      },
    },
    abstentionConditions: ['pattern confidence below threshold', 'no measurable outcome'],
    verificationHooks: ['preregistration-review'],
    bannedTools: ['write_without_review'],
    repoContextAllowed: false,
    liveFetchRequired: false,
  },
  {
    id: 'benchmark-operator',
    name: 'Benchmark Operator',
    description: 'Runs matched control and treatment benchmark arms with MiniMax as the default executor.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['benchmark_runner', 'github_issue_reader', 'answer_sheet_reader'],
    toolPriority: ['benchmark_runner', 'github_issue_reader', 'answer_sheet_reader'],
    setupRequirements: ['privacy_context', 'public_input_snapshot'],
    workflowStages: ['select-benchmark', 'run-control', 'run-treatment', 'capture-artifacts'],
    outputSchema: {
      type: 'object',
      required: ['control', 'treatment'],
      properties: {
        control: { type: 'object' },
        treatment: { type: 'object' },
      },
    },
    abstentionConditions: ['benchmark set unavailable', 'public inputs not snapshotted privately'],
    verificationHooks: ['budget-check', 'provider-parity-check'],
    bannedTools: ['unsnapshotted_public_write'],
    repoContextAllowed: true,
    liveFetchRequired: true,
  },
  {
    id: 'verifier',
    name: 'Verifier',
    description: 'Statistical verifier that validates claims, requests a single revise pass, and emits abstain when evidence is incomplete.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['stats_runner', 'artifact_reader', 'reproduction_runner'],
    toolPriority: ['stats_runner', 'reproduction_runner', 'artifact_reader'],
    setupRequirements: ['privacy_context', 'benchmark_results'],
    workflowStages: ['analyze-results', 'request-revision', 'emit-verdict'],
    outputSchema: {
      type: 'object',
      required: ['verdict', 'evidenceGrade', 'summary'],
      properties: {
        verdict: { type: 'string' },
        evidenceGrade: { type: 'string' },
        summary: { type: 'string' },
      },
    },
    abstentionConditions: ['reproduction failed', 'statistical power insufficient', 'artifact bundle incomplete'],
    verificationHooks: ['reproduction-check'],
    bannedTools: ['issue_creation'],
    repoContextAllowed: false,
    liveFetchRequired: false,
  },
  {
    id: 'issue-escalator',
    name: 'Issue Escalator',
    description: 'Drafts sanitized GitHub issues from repeated, verifier-approved product friction findings.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['finding_reader', 'github_installation_reader', 'issue_deduper'],
    toolPriority: ['finding_reader', 'issue_deduper', 'github_installation_reader'],
    setupRequirements: ['privacy_context', 'sanitization_policy', 'trust_tier'],
    workflowStages: ['cluster-findings', 'sanitize', 'draft-or-open-issue'],
    outputSchema: {
      type: 'object',
      required: ['title', 'body', 'repo'],
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        repo: { type: 'string' },
      },
    },
    abstentionConditions: ['verifier approval missing', 'sensitive content remains', 'repo ownership unclear'],
    verificationHooks: ['sanitization-check', 'dedupe-check'],
    bannedTools: ['raw_trace_export', 'unapproved_issue_open'],
    repoContextAllowed: true,
    liveFetchRequired: true,
  },
];

export const DOGFOOD_REFERENCE_AGENT_SPECS: ResearchAgentSpec[] = [
  {
    id: 'geo-expert',
    name: 'Geo Expert',
    description: 'Reference agent pattern: explicit routing table, mandatory live fetch, and strict tool-constrained domain expertise.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['live_fetch', 'geo_query', 'structured_writer'],
    toolPriority: ['live_fetch', 'geo_query', 'structured_writer'],
    setupRequirements: ['wallet_setup', 'required_secrets'],
    workflowStages: ['live-fetch', 'route-query', 'produce-grounded-answer'],
    outputSchema: JSON_SCHEMA_OBJECT,
    abstentionConditions: ['live fetch unavailable', 'required setup incomplete'],
    verificationHooks: ['live-fetch-confirmed'],
    repoContextAllowed: false,
    liveFetchRequired: true,
  },
  {
    id: 'erc8004-expert',
    name: 'ERC8004 Expert',
    description: 'Reference agent pattern: setup/auth gating, trust labeling, and repo-context support with code tools enabled only when required.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['repo_context', 'spec_reader', 'code_tool'],
    toolPriority: ['spec_reader', 'repo_context', 'code_tool'],
    setupRequirements: ['wallet_setup', 'auth_ready'],
    workflowStages: ['gate-setup', 'read-spec', 'select-code-tools-if-needed'],
    outputSchema: JSON_SCHEMA_OBJECT,
    abstentionConditions: ['setup incomplete', 'trust tier insufficient'],
    verificationHooks: ['setup-check'],
    repoContextAllowed: true,
    liveFetchRequired: false,
  },
  {
    id: 'research-paper-analyst-geo-uploader',
    name: 'Research Paper Analyst GEO Uploader',
    description: 'Reference agent pattern: strict multi-stage paper pipeline, canonical output schema, and provenance-ready publishing.',
    provider: DEFAULT_RESEARCH_PROVIDER,
    allowedTools: ['paper_fetch', 'schema_validator', 'geo_writer'],
    toolPriority: ['paper_fetch', 'schema_validator', 'geo_writer'],
    setupRequirements: ['wallet_setup', 'geo_access'],
    workflowStages: ['fetch-paper', 'analyze', 'validate-schema', 'publish'],
    outputSchema: JSON_SCHEMA_OBJECT,
    abstentionConditions: ['paper not retrievable', 'schema validation fails'],
    verificationHooks: ['schema-check', 'publishing-dry-run'],
    bannedTools: ['unstructured_publish'],
    repoContextAllowed: false,
    liveFetchRequired: true,
  },
];

export const DEFAULT_RESEARCH_AGENT_CATALOG: ResearchAgentCatalog = {
  entries: [
    ...DEFAULT_RESEARCH_AGENT_SPECS.map((spec) => ({ spec, origin: 'research_loop' as const })),
    ...DOGFOOD_REFERENCE_AGENT_SPECS.map((spec) => ({ spec, origin: 'dogfood_reference' as const })),
  ],
};

export function createDefaultResearchPolicyArms(
  _privacyContext: ResearchPrivacyContext,
): ResearchPolicyArm[] {
  return [
    {
      id: 'baseline-current-policy',
      label: 'Current Policy Baseline',
      provider: DEFAULT_RESEARCH_PROVIDER,
      model: DEFAULT_RESEARCH_MODEL,
      strategy: 'baseline',
    },
    {
      id: 'minimax-one-pass',
      label: 'MiniMax One Pass',
      provider: DEFAULT_RESEARCH_PROVIDER,
      model: DEFAULT_RESEARCH_MODEL,
      strategy: 'one_pass',
    },
    {
      id: 'minimax-generate-verify-revise',
      label: 'MiniMax Generate Verify Revise',
      provider: DEFAULT_RESEARCH_PROVIDER,
      model: DEFAULT_RESEARCH_MODEL,
      strategy: 'generate_verify_revise',
    },
    {
      id: 'claude-premium-control',
      label: 'Claude Premium Control',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      strategy: 'premium_control',
    },
  ];
}
