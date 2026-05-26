# Human-Agent Collaboration Contract

Status: draft v0.1
Last updated: 2026-05-26

This contract defines the shared language for connecting human notes, Canvas orchestration, agent sessions, rickydata_git provenance, SDK/KFDB graph writes, and rickydata_notes knowledge views.

The goal is a durable loop:

1. Humans express intent in notes, Canvas workflows, GitHub issues, plans, or CLI commands.
2. Agents execute work through Canvas, Agent Gateway, Hermes, Codex, Claude Code, rickydata_code, or other runners.
3. rickydata_git records provenance around Git work.
4. rickydata SDK clients write normalized graph/trace facts into KFDB.
5. rickydata_notes hydrates those facts into entity docs, backlinks, trace graphs, RDM analyses, and human review inboxes.

## Non-goals

- This contract does not replace rickydata_git as the provenance ledger for Git work.
- This contract does not replace Canvas workflow JSON as the executable orchestration graph.
- This contract does not require rickydata_notes to become an execution engine.
- This contract does not authorize secret rotation or infrastructure deployment.

## Invariants

1. Tenant/wallet scope is explicit.
   - Every write must carry tenant/wallet/project/workspace scope where applicable.
   - UI/client supplied identity headers are not trusted for authorization.

2. Human approvals are first-class.
   - Any mutation with meaningful side effects should have an approval/proof record.
   - Approval decisions record resolver identity, time, target node/action, and decision.

3. Executable graphs and provenance ledgers remain distinct.
   - CanvasWorkflow is a reusable executable graph/template.
   - CanvasRun is one execution of a workflow.
   - TraceSession is an agent/session transcript or event stream.
   - RickydataWorkIntent/Attempt/Run/Patch/Proof are provenance objects around work and Git changes.

4. Sensitive values are not graph data.
   - Store references, hashes, secret names, redacted placeholders, or vault IDs only.
   - Do not store raw API keys, tokens, passwords, private keys, cookies, or connection strings.

5. All facts should be grounded.
   - Claims exposed as proof/completion/decision records should link to evidence: test output, CI job, commit, PR, trace event, artifact hash, screenshot path, or note block.

## Core entity labels

### Human and workspace entities

- WalletTenant
  - key: `wallet:<chain>:<address>` or existing SDK tenant key
  - required properties: `wallet_address`, optional `chain_id`

- HumanActor
  - key: `human:<wallet_address>` or project-defined human ID
  - required properties: `wallet_address` or `external_id`

- Workspace
  - key: `workspace:<workspace_id>`
  - required properties: `workspace_id`

- Project
  - key: `project:<project_id>`
  - required properties: `project_id`

### Human thinking entities

- Note
  - key: notes/KFDB note ID
  - required properties: `note_id`, `title`
  - optional properties: `path`, `notebook`, `created_at`, `updated_at`

- NoteBlock
  - key: notes block ID
  - required properties: `block_id`, `note_id`
  - optional properties: `kind`, `text_hash`, `heading`, `position`

- DesignDecision
  - key: deterministic ID from title/source note/block or SDK graph ID
  - required properties: `title`, `status`
  - optional properties: `decision`, `rationale`, `alternatives`, `source_note_id`, `source_block_id`

- UnderstandingSummary
  - key: deterministic ID from subject/source/session
  - required properties: `subject`, `summary`
  - optional properties: `confidence`, `source_note_id`, `source_session_id`

### Orchestration entities

- CanvasWorkflow
  - key: `canvas-workflow:<workflow_id>` or `canvas-workflow-hash:<normalized_graph_hash>`
  - required properties: `workflow_id` or `workflow_hash`, `name`, `schema_version`
  - optional properties: `description`, `exported_at`, `source_note_id`, `source_block_id`, `created_by`, `wallet_address`, `repository`, `runtime_defaults`

- CanvasRun
  - key: `canvas-run:<run_id>`
  - required properties: `run_id`, `status`
  - optional properties: `workflow_id`, `workflow_hash`, `started_at`, `ended_at`, `runtime_mode`, `initiator_type`, `initiator_id`, `wallet_address`

- CanvasNode
  - workflow definition key: `canvas-node:<workflow_id>:<node_id>`
  - run-specific key: `canvas-run-node:<run_id>:<node_id>`
  - required properties: `node_id`, `kind`
  - optional properties: `label`, `model`, `mode`, `prompt_ref`, `prompt_hash`, `position`, `agent_role`, `tool_name`

- CanvasApproval
  - key: `canvas-approval:<approval_id>` or `canvas-approval:<run_id>:<node_id>`
  - required properties: `approval_id` or `run_id/node_id`, `status`
  - optional properties: `message`, `write_gate`, `requested_at`, `resolved_at`, `resolver_identity`, `decision`, `reason`

- CanvasArtifact
  - key: `canvas-artifact:<artifact_id>` or `canvas-artifact:<run_id>:<node_id>:<hash>`
  - required properties: `artifact_id` or `content_hash`, `kind`
  - optional properties: `mime_type`, `summary`, `note_id`, `block_id`, `file_path`, `uri`

### Agent/session entities

- Agent
  - key: `agent:<agent_id>`
  - required properties: `agent_id`
  - optional properties: `name`, `engine`, `model`, `role`

- AgentSession
  - key: `agent-session:<session_id>`
  - required properties: `session_id`
  - optional properties: `model`, `cwd`, `workspace`, `started_at`, `ended_at`, `engine`

- AgentTraceEvent
  - key: `agent-trace-event:<event_id>`
  - required properties: `event_id`, `event_type`, `timestamp`
  - optional properties: `session_id`, `tool_name`, `command_hash`, `file_path`, `summary`

### Repository/provenance entities

These align with existing SDK `rickydata-graph.ts` concepts.

- Repository
- Commit
- File
- Function
- TypeDefinition
- TestCase
- Symbol
- Dependency
- GitHubIssue
- GitHubProjectItem
- GitHubPullRequest
- RickydataWorkIntent
- RickydataAttempt
- RickydataRun
- RickydataPatch
- RickydataProof
- CIJob
- RelaySnapshot
- KfdbProjection

## Canonical edge types

### Notes and human context

- NOTE_CONTAINS_BLOCK
  - from: Note
  - to: NoteBlock

- NOTE_DEFINES_CANVAS_WORKFLOW
  - from: Note or NoteBlock
  - to: CanvasWorkflow

- NOTE_REFERENCES_CANVAS_RUN
  - from: Note or NoteBlock
  - to: CanvasRun

- NOTE_REFERENCES_REPOSITORY
  - from: Note or NoteBlock
  - to: Repository

- NOTE_RECORDS_DESIGN_DECISION
  - from: Note or NoteBlock
  - to: DesignDecision

- NOTE_SUMMARIZES_UNDERSTANDING
  - from: Note or NoteBlock
  - to: UnderstandingSummary

### Canvas orchestration

- CANVAS_RUN_OF_WORKFLOW
  - from: CanvasRun
  - to: CanvasWorkflow

- CANVAS_WORKFLOW_HAS_NODE
  - from: CanvasWorkflow
  - to: CanvasNode

- CANVAS_RUN_HAS_NODE
  - from: CanvasRun
  - to: CanvasNode

- CANVAS_NODE_DEPENDS_ON_NODE
  - from: CanvasNode
  - to: CanvasNode
  - properties: optional `source_handle`, `target_handle`, `label`

- CANVAS_RUN_TARGETS_REPOSITORY
  - from: CanvasRun
  - to: Repository

- CANVAS_APPROVAL_REQUIRED_FOR_NODE
  - from: CanvasApproval
  - to: CanvasNode

- CANVAS_APPROVAL_RESOLVED_BY_HUMAN
  - from: CanvasApproval
  - to: HumanActor

- CANVAS_NODE_PRODUCED_ARTIFACT
  - from: CanvasNode
  - to: CanvasArtifact

### Sessions and execution

- SESSION_STARTED_CANVAS_RUN
  - from: AgentSession or HumanActor
  - to: CanvasRun

- SESSION_PART_OF_CANVAS_RUN
  - from: AgentSession
  - to: CanvasRun

- CANVAS_NODE_EXECUTED_BY_SESSION
  - from: CanvasNode
  - to: AgentSession

- AGENT_SESSION_HAS_EVENT
  - from: AgentSession
  - to: AgentTraceEvent

- AGENT_SESSION_USED_TOOL
  - from: AgentSession
  - to: Tool or MCPTool where modeled

### rickydata_git/provenance

- WORK_INTENT_DERIVED_FROM_ISSUE
  - from: RickydataWorkIntent
  - to: GitHubIssue

- ATTEMPT_FOR_WORK_INTENT
  - from: RickydataAttempt
  - to: RickydataWorkIntent

- RUN_FOR_ATTEMPT
  - from: RickydataRun
  - to: RickydataAttempt

- PATCH_PRODUCED_BY_RUN
  - from: RickydataPatch
  - to: RickydataRun

- PROOF_VERIFIES_RUN
  - from: RickydataProof
  - to: RickydataRun

- PROOF_VERIFIES_PATCH
  - from: RickydataProof
  - to: RickydataPatch

- RUN_PROJECTED_TO_KFDB
  - from: RickydataRun
  - to: KfdbProjection

- RUN_SYNCED_TO_RELAY
  - from: RickydataRun
  - to: RelaySnapshot

### Canvas to provenance bridge

- CANVAS_RUN_CREATED_WORK_INTENT
  - from: CanvasRun
  - to: RickydataWorkIntent

- CANVAS_NODE_CREATED_ATTEMPT
  - from: CanvasNode
  - to: RickydataAttempt

- CANVAS_NODE_PRODUCED_RUN
  - from: CanvasNode
  - to: RickydataRun

- CANVAS_NODE_PRODUCED_PATCH
  - from: CanvasNode
  - to: RickydataPatch

- CANVAS_NODE_PRODUCED_PROOF
  - from: CanvasNode
  - to: RickydataProof

## Canvas workflow envelope

Canvas workflow JSON should preserve the existing graph shape and add optional provenance metadata rather than replacing the graph.

```json
{
  "version": 1,
  "name": "GitHub Development Loop",
  "description": "Plan, implement, test, and prepare review.",
  "exportedAt": "2026-05-26T00:00:00Z",
  "nodes": [],
  "edges": [],
  "provenance": {
    "created_by": "wallet:1:0x...",
    "source_note_id": "note-id",
    "source_block_id": "block-id",
    "repository": "owner/repo",
    "session_id": "session-id",
    "tags": ["agentic-work", "review"]
  },
  "runtime_defaults": {
    "mode": "read_only",
    "require_approval_for_writes": true,
    "allowed_tools": [],
    "output_policy": "summarize-and-link-evidence"
  }
}
```

Compatibility rule:
- Frontend/export schemas currently use `edges`.
- Some CLI/runtime payloads use `connections`.
- Readers should accept both during migration.
- Writers should prefer `edges` in portable workflow documents and may transform to `connections` for Agent Gateway runtime calls if required.

## Canvas run event requirements

Every Canvas run event stream should include enough metadata to project into KFDB/notes:

- `run_id`
- `workflow_id` or `workflow_hash`
- `node_id` where applicable
- `node_type` or `node_kind` where applicable
- `event_type`
- `timestamp`
- `status`
- `wallet_address` or tenant context where safe and authorized
- `session_id` if an agent session was created or continued
- `approval_id` for approval events
- `artifact_ids` or output references when produced

Recommended event types:

- `run_started`
- `node_started`
- `node_log`
- `approval_required`
- `approval_resolved`
- `node_completed`
- `node_failed`
- `team_agent_event`
- `text`
- `run_completed`
- `run_failed`
- `done`

## Approval semantics

Approval records should include:

- approval ID
- run ID
- node ID
- requested action
- side-effect class: read, write, network, payment, deploy, secret, publish
- requested by: agent/session/node
- resolved by: human/wallet/role
- decision: approve, reject, modify, expire
- reason/comment
- timestamps
- resulting action/proof link

Approval gates should be preserved even if the run fails later.

## Notes integration

rickydata_notes should treat Canvas as an orchestration/provenance source, not just an iframe/app.

Recommended note/block attributes:

- `custom-canvas-workflow-id`
- `custom-canvas-workflow-hash`
- `custom-canvas-run-id`
- `custom-canvas-node-id`
- `custom-canvas-schema-version`
- `custom-provenance-session-id`
- `custom-provenance-wallet`
- `custom-rickydata-work-intent-id`
- `custom-rickydata-attempt-id`

Recommended UX surfaces:

1. Workflow document page
   - Shows workflow JSON, graph summary, node list, required approvals, target repos, recent runs.

2. Canvas run page
   - Shows run timeline, node status, approval decisions, artifacts, linked agent sessions, linked rickydata_git objects.

3. Collaboration inbox
   - Approval required
   - Failed proof/test/CI
   - Proposed patch awaiting review
   - Decision requested
   - Agent blocked on human clarification

4. Global graph inclusion
   - Merge CanvasWorkflow, CanvasRun, CanvasNode, CanvasApproval into existing trace graph/global graph.

## SDK/KFDB write requirements

Writers should use deterministic IDs where possible and include source evidence.

Minimum graph write bundle for a Canvas run:

1. CanvasWorkflow entity or reference.
2. CanvasRun entity.
3. CanvasNode entities for participating nodes.
4. CANVAS_RUN_OF_WORKFLOW edge.
5. CANVAS_RUN_HAS_NODE edges.
6. CANVAS_NODE_DEPENDS_ON_NODE edges.
7. Session/provenance edges when agent sessions, work intents, patches, proofs, commits, or CI jobs are created.
8. Approval entities/edges for any write gate.

Minimum graph write bundle for a rickydata_git-backed code task:

1. Repository entity.
2. GitHubIssue/GitHubProjectItem if sourced from GitHub.
3. RickydataWorkIntent.
4. RickydataAttempt.
5. RickydataRun.
6. RickydataPatch when a patch/change exists.
7. RickydataProof for tests/CI/review evidence.
8. KfdbProjection/RelaySnapshot when projected/synced.
9. Links to CanvasRun/CanvasNode if orchestrated by Canvas.
10. Links to Note/NoteBlock if initiated or reviewed in notes.

## Evidence properties

Use these optional properties across proof-like entities:

- `evidence_kind`: test, ci, screenshot, trace, commit, pr, issue, benchmark, human_review, deployment_check
- `evidence_uri`
- `evidence_hash`
- `command`
- `exit_code`
- `started_at`
- `completed_at`
- `summary`
- `raw_output_ref`

Do not store unbounded raw logs in entity properties; store references or compact summaries.

## Versioning

- Contract version: `human-agent-collaboration/v0.1`
- Graph writers should include `contract_version` on CanvasWorkflow, CanvasRun, RickydataWorkIntent, and KfdbProjection records when possible.
- Breaking changes should create `v0.2`, not silently reinterpret existing graph facts.

## Known current implementation gaps

Grounded from local repo inspection on 2026-05-26:

1. Canvas package/frontend portable schema uses `edges`, while CLI/runtime payloads may use `connections`.
2. mcp-marketplace currently routes `/workspace/*` to `WorkspaceHostPage`; docs mentioning direct `CanvasWorkflowsRoute` import appear stale.
3. rickydata_notes has trace graph primitives but does not yet model CanvasWorkflow/CanvasRun/CanvasNode/CanvasApproval as first-class trace graph labels.
4. rickydata_SDK exports Canvas client/types and graph builders, but the Canvas-to-KFDB graph write bundle is not yet a single canonical helper.
5. rickydata_git integration with rickydata_notes appears indirect through KFDB session/git-operation projection rather than a direct notes dependency.

## First implementation milestones

1. SDK: add typed constants/helpers for Canvas collaboration graph entities and edges.
2. Notes: extend trace graph labels/edges with CanvasWorkflow, CanvasRun, CanvasNode, CanvasApproval.
3. Canvas/Agent Gateway: ensure SSE events carry workflow/run/node/session/approval metadata consistently.
4. Marketplace/docs: resolve CanvasWorkflowsRoute vs WorkspaceHostPage routing docs.
5. rickydata_git: emit WorkIntent/Attempt/Run/Patch/Proof graph facts using SDK helper conventions.
