# Skills and Sub-Agents Reference

Documentation framework based on official Claude Code docs (studied 2026-03-15).

## Skills (`.claude/skills/{name}/SKILL.md`)

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name / slash-command. Defaults to directory name. Lowercase, hyphens, max 64 chars. |
| `description` | Recommended | What the skill does. Claude uses this for auto-invocation decisions. |
| `argument-hint` | No | Hint for autocomplete, e.g. `[issue-number]`. |
| `disable-model-invocation` | No | `true` = only user can invoke via `/name`. Default: `false`. |
| `user-invocable` | No | `false` = hidden from `/` menu, only Claude can load. Default: `true`. |
| `allowed-tools` | No | Tools Claude can use without permission when skill is active. |
| `model` | No | Model to use when skill is active. |
| `context` | No | `fork` = run in a forked subagent context. |
| `agent` | No | Which subagent type to use when `context: fork`. Options: `Explore`, `Plan`, `general-purpose`, or custom agent name. |
| `hooks` | No | Hooks scoped to this skill's lifecycle. |

### String Substitutions

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | All arguments passed when invoking |
| `$ARGUMENTS[N]` / `$N` | Specific argument by 0-based index |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_SKILL_DIR}` | Directory containing the SKILL.md |

### Dynamic Context

`!`command`` syntax runs shell commands before skill content is sent. Output replaces the placeholder.

### Key Rules

- Skill descriptions always loaded into context (budget: 2% of context window, fallback 16k chars)
- Full skill content loads only when invoked
- `context: fork` skills need explicit task instructions (not just guidelines)
- Keep SKILL.md under 500 lines; use supporting files for reference material
- Skills from `--add-dir` directories support live change detection

## Sub-Agents (`.claude/agents/{name}.md`)

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier, lowercase + hyphens |
| `description` | Yes | When Claude should delegate to this agent |
| `tools` | No | Allowlist of tools. Inherits all if omitted. |
| `disallowedTools` | No | Denylist, removed from inherited/specified list |
| `model` | No | `sonnet`, `opus`, `haiku`, full ID, or `inherit` (default) |
| `permissionMode` | No | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | No | Max agentic turns before stop |
| `skills` | No | Skills to preload into agent context at startup |
| `mcpServers` | No | MCP servers: inline definitions or string references |
| `hooks` | No | Lifecycle hooks scoped to this agent |
| `memory` | No | Persistent memory: `user`, `project`, or `local` |
| `background` | No | `true` = always run as background task |
| `isolation` | No | `worktree` = run in temp git worktree |

### Built-in Agents

| Agent | Model | Tools | Purpose |
|-------|-------|-------|---------|
| `Explore` | Haiku | Read-only | Codebase search/analysis |
| `Plan` | Inherit | Read-only | Research for planning |
| `general-purpose` | Inherit | All | Complex multi-step tasks |

### Key Rules

- Subagents receive only their system prompt + env details, not the full Claude Code system prompt
- Subagents cannot spawn other subagents
- Loaded at session start; restart or use `/agents` for immediate load
- `tools` field with `Agent(type1, type2)` restricts which subagents can be spawned (only for `--agent` main thread)
- Permission modes: `bypassPermissions` from parent takes precedence
- Preloaded skills inject full content, not just availability
- Memory directory: `~/.claude/agent-memory/{name}/` (user), `.claude/agent-memory/{name}/` (project), `.claude/agent-memory-local/{name}/` (local)

## Scope Priority

| Level | Skills Path | Agents Path | Priority |
|-------|------------|-------------|----------|
| Enterprise | Managed settings | — | Highest |
| CLI flag | — | `--agents` JSON | Highest |
| Personal | `~/.claude/skills/` | `~/.claude/agents/` | High |
| Project | `.claude/skills/` | `.claude/agents/` | Medium |
| Plugin | `{plugin}/skills/` | `{plugin}/agents/` | Lowest |

Same-name conflicts: higher priority wins (enterprise > personal > project). Plugin uses namespace (`plugin:name`).

## Existing Project Inventory

### Skills
| Name | Type | Model-invocable | Description |
|------|------|-----------------|-------------|
| `canvas-execute` | Task | No (manual only) | Execute canvas workflows via CLI |
| `mcp-search` | Reference/Task | Yes | Search MCP marketplace |
| `research-improve` | Task | Yes | Full research-improve pipeline |
| `research-improve-team` | Task | No (manual only) | Team-mode research pipeline |
| `review-pr` | Task | Yes | Multi-agent PR review via canvas workflow engine |
| `verify-deployment` | Task | Yes | Post-deployment verification setup and execution |
| `verification-analysis` | Task | Yes | Predict, remediate, and dashboard for verification system |

### Agents
| Name | Model | Tools | Purpose |
|------|-------|-------|---------|
| `canvas-workflow-helper` | sonnet | Read/Write/Edit/Bash/Grep/Glob | Canvas .json workflow specialist |
| `sdk-explorer` | haiku | Read/Grep/Glob | SDK architecture explorer |
| `codebase-explorer` | haiku | Read/Grep/Glob/Bash | Deep codebase exploration (Phase 1) |
| `paper-discoverer` | sonnet | Read/Grep/Glob/MCP tools | Paper discovery (Phase 2) |
| `research-synthesizer` | sonnet | Read/Grep/Glob | Research-to-implementation (Phase 3) |
| `docs-expert` | sonnet | Read/Write/Edit/Bash/Glob/Grep | Pattern recording specialist |

## Key Reference Docs

| Doc | Purpose |
|-----|---------|
| `.claude/docs/research-improve-guide.md` | Complete usage guide for `/research-improve` pipeline |
| `.claude/docs/agent-teams-reference.md` | Agent teammates vs sub-agents — API reference for plans |
| `.claude/docs/ecosystem-architecture.md` | Cross-repo architecture overview |
