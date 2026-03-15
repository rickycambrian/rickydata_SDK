---
name: implement-research-plan
description: Implement the top items from a research-improve or research-improve-team plan. Use when you have a synthesized implementation plan and want to execute it systematically. Triggers after /research-improve or /research-improve-team produces a plan.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Implement Research Plan

**Provenance:** Discovered 2026-03-15 in research-improve-team run on rickydata_SDK agent architecture. The pipeline produced a 5-item plan; this skill captures the systematic approach to executing it.

## When to Use

After `/research-improve` or `/research-improve-team` produces a prioritized implementation plan. The plan will have items labeled with effort (S/M/L), impact (H/M/L), and risk (H/M/L).

## Arguments

`$ARGUMENTS` — Optional item number or name to implement (e.g., "1", "error taxonomy"). If blank, implement the first item only and pause for confirmation before continuing.

## Steps

1. **Read the plan**: If no plan is in context, ask the user to paste the synthesized plan or run `/research-improve` first.

2. **Select item**: Pick the top item by impact/effort ratio (High impact + Small effort = first). If `$ARGUMENTS` specifies an item, use that.

3. **Read target files first**: Before editing, read every file listed in the plan's "Target files". Understand existing code structure.

4. **Check prerequisites**: The plan may list prerequisite items (e.g., "error taxonomy must come before retry logic"). Implement prerequisites first.

5. **Implement**: Make changes file by file, following the plan's steps exactly. Prefer editing existing files over creating new ones.

6. **Verify**: Run the verification steps from the plan. For TypeScript:
   ```bash
   cd packages/core && npx tsc --noEmit
   npm test
   ```

7. **Pause before next item**: After completing one item, report what changed and ask whether to continue to the next item.

## Standard Plan Format

Plans from `research-improve` use this structure — reference it when reading:

```
### [Improvement Name]
Effort: S/M/L | Impact: H/M/L | Risk: H/M/L
Target files: [paths]
Steps: 1. ... 2. ...
Verification: [how to test]
Research basis: [paper + technique]
```

## Known Limitations

- This skill implements code changes; it does not run live system tests or integration tests against the real API.
- Plans derived from paper research may need adaptation to the codebase's actual conventions — always read target files before editing.
- High-risk items (H risk) should be reviewed with the user before committing.
