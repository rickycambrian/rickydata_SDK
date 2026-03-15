# Agent Teams vs Sub-Agents — Quick Reference

## When Plans Include Agent Teams

When writing or executing plans that use agent teams, include this reference so the executor knows the correct API after context resets.

## The Critical Distinction

| | Sub-Agent (one-shot) | Agent Teammate (persistent) |
|---|---|---|
| **Create** | `Agent(subagent_type: "X", prompt: "...")` | First `TeamCreate(team_name: "T")`, then `Agent(name: "X", team_name: "T", prompt: "...")` |
| **Communication** | Returns result, then dies | Uses `SendMessage(to: "name", message: "...")` |
| **Task tracking** | None | Shared `TaskList` via `TaskCreate`/`TaskUpdate` |
| **Lifecycle** | Disposable | Lives until `SendMessage(message: {type: "shutdown_request"})` |
| **Can talk to peers** | No | Yes, via `SendMessage(to: "peer-name", ...)` |
| **Idle state** | N/A | Goes idle after each turn — normal, not an error |

## Full Agent Team Lifecycle

```
1. TeamCreate(team_name: "my-team")
2. TaskCreate(subject: "Task 1", description: "...")  → ID "1"
   TaskCreate(subject: "Task 2", description: "...")  → ID "2"
   TaskUpdate(taskId: "2", addBlockedBy: ["1"])
3. Agent(name: "worker-1", team_name: "my-team", subagent_type: "general-purpose", prompt: "...")
   Agent(name: "worker-2", team_name: "my-team", subagent_type: "general-purpose", prompt: "...")
4. TaskUpdate(taskId: "1", owner: "worker-1", status: "in_progress")
   SendMessage(to: "worker-1", message: "Start task #1", summary: "Assign task 1")
5. [Worker-1 completes, sends result via SendMessage]
6. TaskUpdate(taskId: "2", owner: "worker-2", status: "in_progress")
   SendMessage(to: "worker-2", message: "Here's context from worker-1: ...", summary: "Relay to worker-2")
7. [Worker-2 completes]
8. SendMessage(to: "worker-1", message: {type: "shutdown_request", reason: "Done"})
   SendMessage(to: "worker-2", message: {type: "shutdown_request", reason: "Done"})
9. TeamDelete()
```

## Key Rules for Plans

### 1. Always include team_name AND name when spawning teammates

```
# CORRECT — creates a teammate
Agent(name: "explorer", team_name: "my-team", subagent_type: "codebase-explorer", prompt: "...")

# WRONG — creates a disposable sub-agent
Agent(subagent_type: "codebase-explorer", prompt: "...")
```

### 2. Teammates communicate via SendMessage, not return values

```
# Team lead relays output between teammates
SendMessage(to: "researcher", message: "Explorer found these gaps: ...", summary: "Relay gaps")
```

### 3. Task dependencies control execution order

```
TaskCreate(subject: "Phase 1") → ID "1"
TaskCreate(subject: "Phase 2") → ID "2"
TaskUpdate(taskId: "2", addBlockedBy: ["1"])  # Phase 2 waits for Phase 1
```

### 4. Team lead assigns tasks via TaskUpdate

```
TaskUpdate(taskId: "1", owner: "explorer", status: "in_progress")
```

### 5. Idle is normal

Teammates go idle after every turn. This is NOT an error. Send them a message to wake them up.

### 6. Always shutdown gracefully

```
SendMessage(to: "worker", message: {type: "shutdown_request", reason: "All tasks complete"})
# Wait for shutdown approval
TeamDelete()
```

## What to Include in Plans for Post-Context-Reset Execution

When writing plans that will be executed after a context reset, always include:

1. **Explicit tool names**: `TeamCreate`, `TaskCreate`, `TaskUpdate`, `SendMessage`, `TeamDelete`
2. **The teammate vs sub-agent distinction**: Copy the table above into the plan
3. **Exact Agent() call syntax**: Show `name` + `team_name` parameters
4. **SendMessage relay pattern**: Show how to pass output from one teammate to the next
5. **Idle state explanation**: Note that idle is normal, not an error
6. **Shutdown protocol**: Show the shutdown_request message format
7. **Task dependency setup**: Show `addBlockedBy` for sequential tasks

## Verified Production Team Pattern

**Provenance:** Verified 2026-03-15. `sdk-production-hardening` team ran 5 parallel teammates with 4 code tasks + 1 docs task. All tasks completed. 560 tests pass, zero type errors.

### Working Composition (parallel code + docs)

| Teammate | Role | Tasks |
|----------|------|-------|
| `canvas-engineer` | canvas-workflow-helper agent | Fix canvas-client.ts bugs (#1), Final verification (#7) |
| `sse-consolidator` | general-purpose | Consolidate SSE parsing (#2) |
| `github-fixer` | general-purpose | Fix useRef import (#3) |
| `test-engineer` | general-purpose | Add PR review pipeline tests (#4) |
| `docs-expert` | docs-expert agent | Study docs (#5), Record patterns (#6) |

### Key Design: Parallel Execution with Blocked Docs Task

Code tasks (#1–4) ran in parallel. Docs task (#6) was blocked on #1–4 completing (via `addBlockedBy`). This prevented docs from recording speculative patterns before code was verified.

```
TaskUpdate(taskId: "6", addBlockedBy: ["1", "2", "4"])
```

### What Made It Work

1. **Specific subagent_type per role** — `canvas-workflow-helper` for canvas work, `docs-expert` for documentation. Specialized agents outperform general-purpose for domain work.
2. **Task blocking for sequencing** — docs task blocked on code tasks; team lead waited for completion signals before unblocking
3. **Owner assignment via TaskUpdate** — each teammate claimed tasks with `owner` + `status: "in_progress"` before starting
4. **Idle is normal** — teammates went idle between turns; team lead sent `SendMessage` to wake them with context when needed

## Common Mistakes After Context Reset

| Mistake | What happens | Fix |
|---------|-------------|-----|
| Using `Agent(subagent_type: "X")` without `team_name`/`name` | Creates sub-agent, not teammate | Add `name` and `team_name` params |
| Not using `SendMessage` to relay outputs | Teammates never receive context from prior phases | Team lead must relay via `SendMessage` |
| Treating idle notifications as errors | Panic, re-spawning teammates | Idle is normal — just send a message |
| Not creating `TaskCreate` before spawning | No shared task list | Create all tasks first, then spawn teammates |
| Using `TaskUpdate` without `owner` | Tasks never assigned | Set `owner: "teammate-name"` |
| Forgetting `ToolSearch` for MCP tools | Deferred tools fail silently | Include ToolSearch instruction in teammate prompt |
