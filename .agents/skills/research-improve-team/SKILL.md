---
name: research-improve-team
description: Team-mode research-driven codebase improvement. Spawns a 4-agent team for parallel research and implementation planning. Use for larger improvement efforts.
disable-model-invocation: true
---

# Research Improvement Team

Spawn a coordinated agent team for research-driven codebase improvement.

## Arguments

`$ARGUMENTS` — Focus area for improvement (required).

---

## CRITICAL: Agent Teammates vs Sub-Agents

**This skill uses AGENT TEAMMATES, not sub-agents.** These are fundamentally different:

| | Sub-Agent | Agent Teammate |
|---|---|---|
| How to spawn | `Agent(subagent_type: "X", prompt: "...")` | `Agent(name: "X", team_name: "team", prompt: "...")` |
| Communication | Returns result to caller, then dies | Persistent — uses `SendMessage` to talk to teammates |
| Task tracking | None | Shared `TaskList` — claims tasks, marks complete |
| Lifecycle | One-shot | Lives until `shutdown_request` is sent |
| Idle state | N/A | Goes idle after each turn, wakes on `SendMessage` |

**DO NOT use `Agent(subagent_type: ...)` for this skill.** That creates disposable sub-agents that cannot communicate with each other. Instead, follow the exact steps below.

---

## Step 1: Create the Team

```
TeamCreate(
  team_name: "research-improve-team",
  description: "Research-driven codebase improvement focused on: $ARGUMENTS"
)
```

This creates the team AND a shared task list at `~/.Codex/tasks/research-improve-team/`.

## Step 2: Create Tasks with Dependencies

Create 4 tasks, with blocking dependencies so they execute in order:

```
TaskCreate(
  subject: "Explore codebase for gaps in $ARGUMENTS",
  description: "Thoroughly explore the repository. Read AGENTS.md, scan for TODOs/FIXMEs, assess test coverage, map module structure. Focus on: $ARGUMENTS. Produce a structured gap report with architecture summary, identified gaps (file:line references), technical debt, and top 3-5 improvement areas ranked by impact. When done, send the FULL report to team lead via SendMessage."
)
→ Returns task ID (e.g., "1")

TaskCreate(
  subject: "Discover papers for $ARGUMENTS gaps",
  description: "Wait for the exploration report from the team lead. Use the rickydata-proxy MCP tools: (1) Call ToolSearch to load deferred tool schemas first, (2) Call discover_papers with queries derived from gaps, using maxResults: 20-30 and appropriate arXiv categories, (3) Call exa_search with search_type: 'deep_research' for industry sources, (4) Rank results 1-5 on applicability, (5) Call extract_paper_content on top 3-5 papers. Send ranked list with extraction details to team lead via SendMessage."
)
→ Returns task ID (e.g., "2")
TaskUpdate(taskId: "2", addBlockedBy: ["1"])

TaskCreate(
  subject: "Synthesize implementation plan for $ARGUMENTS",
  description: "Wait for both the exploration report AND paper analyses from the team lead. Cross-reference codebase gaps with paper techniques. For each gap, identify the best paper technique, assess feasibility, estimate effort (S/M/L) and impact (H/M/L). Produce a prioritized implementation plan with specific file paths, step-by-step guidance, and verification strategies for the top 3 improvements. Send the full plan to team lead via SendMessage."
)
→ Returns task ID (e.g., "3")
TaskUpdate(taskId: "3", addBlockedBy: ["2"])

TaskCreate(
  subject: "Record verified patterns from this research run",
  description: "Wait for the full pipeline output from the team lead. Study the Codex skills docs (https://code.Codex.com/docs/en/skills) and sub-agents docs (https://code.Codex.com/docs/en/sub-agents). Analyze the full pipeline output for reusable patterns: successful tool sequences, effective queries, team compositions that worked. Only record patterns that were VERIFIED WORKING in this session. Create or update skills in .Codex/skills/ and agents in .Codex/agents/. Update AGENTS.md with references. Send summary of what was recorded to team lead via SendMessage."
)
→ Returns task ID (e.g., "4")
TaskUpdate(taskId: "4", addBlockedBy: ["3"])
```

## Step 3: Spawn Agent Teammates

Spawn 4 named teammates. Each must include `team_name` and `name` parameters:

### Explorer

```
Agent(
  name: "explorer",
  team_name: "research-improve-team",
  subagent_type: "codebase-explorer",
  prompt: "You are the 'explorer' teammate on the 'research-improve-team'. Your job: thoroughly explore this codebase with focus on '$ARGUMENTS'. Check TaskList for your assigned task. Mark it in_progress when starting, completed when done. Send your FULL exploration report to the team lead via SendMessage(to: 'user', message: '<your report>', summary: 'Exploration report complete'). Include architecture summary, gaps with file:line references, technical debt, test coverage, and top 3-5 improvement areas."
)
```

### Researcher

```
Agent(
  name: "researcher",
  team_name: "research-improve-team",
  subagent_type: "paper-discoverer",
  prompt: "You are the 'researcher' teammate on the 'research-improve-team'. Your task is blocked until the explorer finishes. Wait for the exploration report from the team lead. When you receive it, check TaskList and claim your task. IMPORTANT: Before calling any mcp__rickydata-proxy__* tool, you MUST first call ToolSearch(query: 'select:mcp__rickydata-proxy__research-paper-analyst-geo-uploader__discover_papers,mcp__rickydata-proxy__research-paper-analyst-geo-uploader__extract_paper_content,mcp__rickydata-proxy__research-paper-analyst-geo-uploader__exa_search') to load the tool schemas. Then follow the sweep pattern: discover_papers with maxResults: 20-30, exa_search with search_type: 'deep_research', extract_paper_content on top 3-5 papers. Send FULL results to team lead via SendMessage."
)
```

### Synthesizer

```
Agent(
  name: "synthesizer",
  team_name: "research-improve-team",
  subagent_type: "research-synthesizer",
  prompt: "You are the 'synthesizer' teammate on the 'research-improve-team'. Your task is blocked until the researcher finishes. Wait for both the exploration report AND paper analyses from the team lead. When you receive them, check TaskList and claim your task. Cross-reference codebase gaps with paper techniques. Produce a prioritized implementation plan with effort/impact estimates, specific file paths, step-by-step guidance, and verification strategies. Send the FULL plan to team lead via SendMessage."
)
```

### Documenter

```
Agent(
  name: "documenter",
  team_name: "research-improve-team",
  subagent_type: "docs-expert",
  prompt: "You are the 'documenter' teammate on the 'research-improve-team'. Your task is blocked until the synthesizer finishes. Wait for the full pipeline output from the team lead. First study Codex docs on skills and sub-agents. Then analyze the pipeline output for reusable patterns. CRITICAL: Only record patterns that were VERIFIED WORKING in this session. Do NOT hallucinate or record patterns you haven't confirmed. Create skills in .Codex/skills/, update agents in .Codex/agents/, and add references to AGENTS.md. Send summary to team lead via SendMessage."
)
```

## Step 4: Assign First Task and Coordinate

The team lead (you) orchestrates the pipeline by relaying outputs between teammates:

### 4a. Assign Task #1 to Explorer

```
TaskUpdate(taskId: "1", owner: "explorer", status: "in_progress")
SendMessage(
  to: "explorer",
  message: "Start exploring the codebase. Focus on: $ARGUMENTS. Your task (#1) is assigned. When done, send your full report back to me.",
  summary: "Assign exploration task to explorer"
)
```

### 4b. When Explorer Completes → Relay to Researcher

When you receive the exploration report from the explorer:

```
TaskUpdate(taskId: "2", owner: "researcher", status: "in_progress")
SendMessage(
  to: "researcher",
  message: "Here is the exploration report from the explorer:\n\n<exploration_report>\n[PASTE EXPLORER'S FULL OUTPUT HERE]\n</exploration_report>\n\nYour task (#2) is assigned. Discover relevant papers based on these gaps. Remember to call ToolSearch first to load MCP tool schemas.",
  summary: "Relay exploration report to researcher"
)
```

### 4c. When Researcher Completes → Relay to Synthesizer

When you receive paper analyses from the researcher:

```
TaskUpdate(taskId: "3", owner: "synthesizer", status: "in_progress")
SendMessage(
  to: "synthesizer",
  message: "Here is the exploration report:\n\n<exploration_report>\n[PASTE EXPLORER OUTPUT]\n</exploration_report>\n\nHere are the paper analyses:\n\n<paper_analyses>\n[PASTE RESEARCHER OUTPUT]\n</paper_analyses>\n\nYour task (#3) is assigned. Cross-reference and produce a prioritized implementation plan.",
  summary: "Relay papers to synthesizer"
)
```

### 4d. When Synthesizer Completes → Relay to Documenter

When you receive the implementation plan:

```
TaskUpdate(taskId: "4", owner: "documenter", status: "in_progress")
SendMessage(
  to: "documenter",
  message: "Here is the full pipeline output:\n\n<exploration_report>\n[EXPLORER OUTPUT]\n</exploration_report>\n\n<paper_analyses>\n[RESEARCHER OUTPUT]\n</paper_analyses>\n\n<implementation_plan>\n[SYNTHESIZER OUTPUT]\n</implementation_plan>\n\nYour task (#4) is assigned. Record only verified working patterns as skills. Do not hallucinate information.",
  summary: "Relay full context to documenter"
)
```

## Step 5: Compile Final Report

After all 4 teammates complete, compile:

```markdown
## Research-Driven Improvement Report

**Team**: research-improve-team
**Focus**: $ARGUMENTS
**Date**: [timestamp]

### Exploration Summary
[From explorer — Task #1]

### Papers Discovered
[From researcher — Task #2]

### Implementation Plan
[From synthesizer — Task #3]

### Patterns Captured
[From documenter — Task #4]
```

## Step 6: Shutdown and Cleanup

Send shutdown requests to all teammates, then delete the team:

```
SendMessage(to: "explorer", message: {type: "shutdown_request", reason: "All tasks complete"})
SendMessage(to: "researcher", message: {type: "shutdown_request", reason: "All tasks complete"})
SendMessage(to: "synthesizer", message: {type: "shutdown_request", reason: "All tasks complete"})
SendMessage(to: "documenter", message: {type: "shutdown_request", reason: "All tasks complete"})
```

Wait for shutdown approvals, then:

```
TeamDelete()
```

---

## Understanding Idle State

Teammates go idle after every turn — **this is normal**. An idle teammate is NOT done or broken. It means they completed their current turn and are waiting for input.

- When a teammate sends you a message and goes idle → they sent their deliverable and await your next instruction
- To wake an idle teammate → send them a `SendMessage`
- Do NOT treat idle notifications as errors or completion signals
- Check `TaskList` to see actual task status (pending/in_progress/completed)

## Prerequisites

- `rickydata-proxy` MCP server connected: `Codex mcp list | grep rickydata-proxy`
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.Codex/settings.json`
- Research agent enabled: `rickydata mcp agent list`
