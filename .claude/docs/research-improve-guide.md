# Research-Driven Codebase Improvement — Complete Guide

## What It Does

`/research-improve` is a Claude Code skill that systematically improves any rickydata codebase by:

1. **Exploring** the repo for architectural gaps, TODOs, missing tests, and technical debt
2. **Discovering** relevant academic papers and industry sources via the Research Paper Analyst MCP agent
3. **Synthesizing** a prioritized implementation plan that maps paper techniques to specific codebase gaps

The result is a concrete, research-backed improvement plan with file paths, effort estimates, and step-by-step implementation guidance.

## Available In

| Repository | Skills | Agents |
|-----------|--------|--------|
| `rickydata_SDK` | `/research-improve`, `/research-improve-team` | codebase-explorer, paper-discoverer, research-synthesizer, docs-expert |
| `knowledgeflow_db` | `/research-improve`, `/research-improve-team` | codebase-explorer, paper-discoverer, research-synthesizer |
| `ai_research` | `/research-improve`, `/research-improve-team` | codebase-explorer, paper-discoverer, research-synthesizer |
| `rickydata_github` | `/research-improve`, `/research-improve-team` | codebase-explorer, paper-discoverer, research-synthesizer, docs-expert |

---

## Prerequisites

### 1. Install the rickydata CLI

```bash
npm install -g rickydata
```

### 2. Connect the rickydata-proxy MCP server

The pipeline uses the `research-paper-analyst-geo-uploader` agent mounted through the `rickydata-proxy` MCP server. This proxy aggregates tools from enabled agents and makes them available in Claude Code.

```bash
# One-time setup (also done during `rickydata init`)
rickydata mcp proxy-connect
```

After connecting, restart Claude Code so it picks up the new MCP server.

### 3. Verify the connection

```bash
# In your terminal
claude mcp list | grep rickydata-proxy
```

You should see `rickydata-proxy` listed as "Connected". If not, run `rickydata mcp proxy-connect` again and restart.

### 4. Verify the research agent is enabled

```bash
rickydata mcp agent list
```

You should see `research-paper-analyst-geo-uploader` in the enabled agents list. If not:

```bash
rickydata mcp agent enable research-paper-analyst-geo-uploader
```

The proxy hot-swaps tools — no restart needed after enabling agents.

---

## Usage

### Single-Agent Mode (`/research-improve`)

Run in any repo that has the skill installed:

```
/research-improve                          # Full pipeline, auto-detect focus
/research-improve "query optimization"     # Full pipeline, specific focus area
/research-improve "SSE streaming"          # Full pipeline, specific focus area
```

#### Phased Invocation

You can stop the pipeline at any phase:

```
/research-improve explore                  # Phase 1 only — codebase exploration
/research-improve discover                 # Phases 1-2 — exploration + paper discovery
/research-improve analyze                  # Phases 1-2 — same as discover (extraction is included)
```

This is useful for:
- **`explore`** — Quick gap analysis without any MCP calls
- **`discover`** — See what papers are available before committing to full synthesis
- Running phases incrementally when you want to review output between steps

### Team Mode (`/research-improve-team`)

For larger improvement efforts, team mode spawns 4 coordinated agents that work with task dependencies:

```
/research-improve-team "dynamic agent proxy"
```

**Requires**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json` (already configured in all 4 repos).

Team mode spawns:
- `explorer` (codebase-explorer agent) — explores the repo
- `researcher` (paper-discoverer agent) — discovers and extracts papers
- `synthesizer` (research-synthesizer agent) — produces implementation plan
- `documenter` (docs-expert agent) — records verified patterns as new skills

The team lead coordinates handoffs between teammates via `SendMessage`.

---

## Pipeline Architecture

### Phase 1: Codebase Exploration

**Agent**: `codebase-explorer` (model: haiku — fast and cheap)

Reads CLAUDE.md, scans for TODOs/FIXMEs, counts test coverage, maps module structure, checks git log for active areas. Produces a structured report with:

- Architecture summary (module map with file paths)
- Identified gaps (with `file:line` references)
- Technical debt inventory
- Test coverage assessment
- Recommended focus areas ranked by impact

### Phase 2: Paper Discovery & Extraction

**Agent**: `paper-discoverer` (model: sonnet)

Uses a verified 3-sweep pattern that was validated on 2026-03-15 (120 papers reviewed, 10 curated, top 5 extracted):

1. **Sweep 1 — arXiv**: Calls `discover_papers` for each query formulated from the gaps. Targets 30-50 results per query using `maxResults: 20-30` and appropriate arXiv categories (`cs.DB`, `cs.AI`, `cs.CL`, `cs.SE`, etc.).

2. **Sweep 2 — Web/Industry**: Calls `exa_search` with `search_type: "deep_research"` for industry blog posts, conference talks, and engineering reports.

3. **Sweep 3 — Broadening**: If sweeps 1-2 miss key topics, calls `agent_chat` to ask the research agent for adjacent research areas.

Results are ranked 1-5 on applicability, and `extract_paper_content` is called on the top 3-5 papers (score 4-5) to get full structured content including core technique, implementation requirements, performance claims, and limitations.

### Phase 3: Synthesis

**Agent**: `research-synthesizer` (model: sonnet)

Receives both the exploration report and paper analyses. For each codebase gap, identifies the best matching paper technique and assesses feasibility given the codebase's language, architecture, and conventions. Produces a prioritized implementation plan with:

- Effort estimate (Small/Medium/Large)
- Impact estimate (High/Medium/Low)
- Specific target files
- Step-by-step implementation guidance
- Verification strategy
- Research evidence and caveats

---

## MCP Tools Reference

The paper-discoverer agent uses these tools from the `rickydata-proxy` MCP server:

### `discover_papers`

Searches arXiv and web sources for academic papers.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `query` | Yes | Search query | `"graph database query optimization"` |
| `category` | No | arXiv category filter | `"cs.DB"`, `"cs.AI"`, `"cs.CL"`, `"stat.ML"` |
| `maxResults` | No | Max papers to return (default 10, max 50) | `20` |
| `dateRange` | No | Date filter | `"last30days"`, `"last7days"`, `"2024-06 to 2025-01"` |

### `extract_paper_content`

Extracts full structured content from a paper.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `arxivId` | No* | arXiv paper ID | `"2501.12345"` |
| `url` | No* | Paper page URL | `"https://arxiv.org/abs/2501.12345"` |
| `pdfUrl` | No* | Direct PDF URL | — |

*At least one must be provided.

### `exa_search`

Web search via Exa AI. Use `search_type: "deep_research"` for best results.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `query` | Yes | Search query | `"MCP server SDK best practices 2025"` |
| `search_type` | No | Search mode | `"web"`, `"deep_research"`, `"code"`, `"advanced"` |
| `num_results` | No | Number of results (default 8) | `10` |

### `agent_chat`

Conversational interface to the research agent. Use for exploratory queries.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `message` | Yes | Your question | `"What are the latest papers on temporal KG reasoning?"` |
| `verbose` | No | Show internal tool calls | `true` |

### `web_research`

Web research with source verification and citations.

| Parameter | Required | Description | Example |
|-----------|----------|-------------|---------|
| `topic` | Yes | Research topic | `"state of the art in graph database indexing 2025"` |

---

## Example Output

A successful full-pipeline run produces output like:

```markdown
## Research-Driven Improvement Plan

**Repository**: rickydata_SDK
**Focus**: dynamic agent proxy
**Date**: 2026-03-15

### Research Sources
| # | Paper | Key Technique | Relevance |
|---|-------|---------------|-----------|
| 1 | OSWorld-MCP: Benchmarking MCP Tool Invocation (2510.24563) | Tool description structuring for higher invocation rates | 5/5 |
| 2 | The Instability of All Backoff Protocols (2602.21315) | Jittered reconnect strategies vs pure exponential backoff | 4/5 |
| 3 | MCP Security Analysis (Queen's U.) | Tool poisoning detection, credential exposure patterns | 4/5 |

### Recommended Improvements (Priority Order)
1. SSE Reconnection with Jitter — Small effort, High impact
   - Research: Backoff protocol instability paper — jittered retry avoids correlated storms
   - Target: packages/core/src/agent/agent-client.ts
   - Steps: [1. Add reconnection logic, 2. Implement jitter, 3. Add max retry limit]
   - Verification: Unit test with simulated disconnects

2. MCP Tool Schema Validation — Medium effort, High impact
   - Research: OSWorld-MCP — structured descriptions improve invocation rate by 12%
   - Target: packages/core/src/mcp/agent-mcp-proxy.ts
   - Steps: [1. Validate tool schemas, 2. Normalize descriptions, 3. Add error boundaries]
   - Verification: Integration test with malformed tool definitions
```

---

## Troubleshooting

### "rickydata-proxy not connected"

```bash
rickydata mcp proxy-connect   # Re-register the proxy
# Then restart Claude Code
```

### Phase 2 returns no papers

- Try broader queries (problem domain instead of exact technique)
- Use `agent_chat` for exploratory search: it combines multiple search strategies
- Check if the research agent is enabled: `rickydata mcp agent list`

### Sub-agents not found

Custom agents from `.claude/agents/` are loaded at session start. If you just created them, restart Claude Code.

### Team mode not working

Verify `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in `.claude/settings.json` and restart the session.

---

## How It Was Built

This pipeline was developed by manually running the research workflow (codebase exploration → paper discovery → synthesis) against the KFDB codebase, then codifying the verified patterns as reusable Claude Code skills and agents. The sweep pattern (120 reviewed → 10 curated → 5 extracted) was validated on 2026-03-15 and baked into the paper-discoverer agent instructions.

Key design decisions:
- **Haiku for exploration** — fast and cheap, only needs read access
- **Sonnet for discovery and synthesis** — needs reasoning for query formulation and cross-referencing
- **Deferred tool schemas** — agents must call `ToolSearch` before using MCP tools
- **Full output handoff** — each phase passes complete output to the next (no summarization)
- **Phased invocation** — users can stop at any phase to review before continuing
