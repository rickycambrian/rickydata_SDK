---
name: research-improve-team
description: Team-mode research-driven codebase improvement. Spawns a 4-agent team for parallel research and implementation planning. Use for larger improvement efforts.
disable-model-invocation: true
---

# Research Improvement Team

Spawn a coordinated agent team for research-driven codebase improvement.

## Arguments

`$ARGUMENTS` — Focus area for improvement (required).

## Team Setup

Create a team and 4 tasks with dependencies:

1. **TeamCreate**: `research-improve-team`
2. **Tasks**:
   - Task #1: "Explore codebase for gaps in [$ARGUMENTS]" — unblocked
   - Task #2: "Discover papers for [$ARGUMENTS] gaps" — blocked by #1
   - Task #3: "Synthesize implementation plan for [$ARGUMENTS]" — blocked by #2
   - Task #4: "Record verified patterns from this research run" — blocked by #3

## Teammate Spawning

Spawn 4 named teammates:

| Name | Sub-agent Type | Prompt |
|------|---------------|--------|
| `explorer` | `codebase-explorer` | Thoroughly explore this repo. Focus: $ARGUMENTS. Produce structured gap report. Send results to team lead when done. |
| `researcher` | `paper-discoverer` | Wait for exploration report from team lead. Use MCP proxy tools to discover and extract papers. Send findings to team lead. |
| `synthesizer` | `research-synthesizer` | Wait for both exploration report and paper analyses from team lead. Cross-reference and produce prioritized implementation plan. Send to team lead. |
| `documenter` | `docs-expert` | Wait for the full pipeline output from team lead. Identify reusable patterns. Record only verified working patterns as skills. Send summary to team lead. |

## Coordination Protocol

1. Assign Task #1 to `explorer` (only unblocked task)
2. When `explorer` completes: relay exploration report to `researcher` via SendMessage, unblock Task #2
3. When `researcher` completes: relay paper analyses to `synthesizer` via SendMessage, unblock Task #3
4. When `synthesizer` completes: relay full context to `documenter` via SendMessage, unblock Task #4
5. When `documenter` completes: compile final report, shut down team

## Final Output

Compile all teammate outputs into a single report:

```markdown
## Research-Driven Improvement Report

**Team**: research-improve-team
**Focus**: $ARGUMENTS
**Date**: [timestamp]

### Exploration Summary
[From explorer]

### Papers Discovered
[From researcher]

### Implementation Plan
[From synthesizer]

### Patterns Captured
[From documenter]
```
