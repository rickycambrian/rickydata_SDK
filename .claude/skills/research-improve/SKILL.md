---
name: research-improve
description: Research-driven codebase improvement. Explores the codebase for gaps, discovers relevant academic papers via the research-paper-analyst agent, extracts key findings, and synthesizes a concrete implementation plan. Use when you want research-backed improvements.
allowed-tools: Read, Grep, Glob, Bash, Agent, ToolSearch, mcp__rickydata-proxy__research-paper-analyst-geo-uploader__agent_chat, mcp__rickydata-proxy__research-paper-analyst-geo-uploader__discover_papers, mcp__rickydata-proxy__research-paper-analyst-geo-uploader__extract_paper_content, mcp__rickydata-proxy__research-paper-analyst-geo-uploader__exa_search, mcp__rickydata-proxy__research-paper-analyst-geo-uploader__web_research
---

# Research-Driven Codebase Improvement

Systematically improve this codebase by cross-referencing its gaps with current academic research.

## Arguments

`$ARGUMENTS` — Optional focus area (e.g., "query optimization", "SSE reliability"). If blank, auto-detect from codebase exploration. Special values: `explore` (Phase 1 only), `discover` (Phases 1-2), `analyze` (Phases 1-3).

## Phase 1: Deep Codebase Exploration

Spawn the `codebase-explorer` sub-agent:

```
Agent(
  subagent_type: "codebase-explorer",
  prompt: "Explore this codebase thoroughly. Focus area: $ARGUMENTS (or auto-detect if blank). Produce a structured report with: architecture summary, identified gaps with file:line references, technical debt, test coverage assessment, and top 3-5 recommended improvement areas ranked by impact."
)
```

**Output**: Structured exploration report with architecture summary, gap list, and recommended focus areas.

**If `$ARGUMENTS` is `explore`**: STOP HERE. Present the exploration report.

## Phase 2: Research Paper Discovery & Extraction

Spawn the `paper-discoverer` sub-agent, passing the Phase 1 output as context:

```
Agent(
  subagent_type: "paper-discoverer",
  prompt: "Here is the codebase exploration report:\n\n<exploration_report>\n[PASTE FULL PHASE 1 OUTPUT HERE]\n</exploration_report>\n\nBased on the identified gaps, discover relevant academic papers. Use discover_papers with specific queries and arXiv categories, exa_search with search_type 'deep_research' for industry sources, and extract_paper_content on the top 3-5 papers. Return a ranked list with full extraction details."
)
```

The paper-discoverer will:
1. Formulate 2-3 search queries from the gaps
2. Call `discover_papers` with appropriate `query`, `category`, `maxResults`, and `dateRange`
3. Call `exa_search` with `search_type: "deep_research"` for industry sources
4. Rank all results by applicability (1-5 score)
5. Call `extract_paper_content` with `arxivId` on the top 3-5 papers
6. Return ranked list with full extraction details per paper

**Output**: Ranked paper list with relevance scores, key techniques, and extracted content.

**If `$ARGUMENTS` is `discover`**: STOP HERE. Present paper list.

**If `$ARGUMENTS` is `analyze`**: STOP HERE. Present paper analyses.

## Phase 3: Synthesis — Implementation Plan

Spawn the `research-synthesizer` sub-agent, passing both Phase 1 and Phase 2 outputs:

```
Agent(
  subagent_type: "research-synthesizer",
  prompt: "Here is the codebase exploration report:\n\n<exploration_report>\n[PASTE PHASE 1 OUTPUT]\n</exploration_report>\n\nHere are the research paper analyses:\n\n<paper_analyses>\n[PASTE PHASE 2 OUTPUT]\n</paper_analyses>\n\nCross-reference the codebase gaps with the paper techniques. Produce a prioritized implementation plan with effort/impact estimates, specific file paths, and step-by-step guidance for the top 3 improvements."
)
```

**Output**: Final report with:

```markdown
## Research-Driven Improvement Plan

**Repository**: [name]
**Focus**: [area]
**Date**: [timestamp]

### Research Sources
| # | Paper | Key Technique | Relevance |
|---|-------|---------------|-----------|

### Recommended Improvements (Priority Order)
1. [Name] — [effort], [impact]
   - Research: [paper + technique]
   - Target: [files]
   - Steps: [1, 2, 3]
   - Verification: [how to test]
```

## Orchestration Notes

- Each phase depends on the previous. Run sequentially, not in parallel.
- Pass the FULL output of each phase to the next agent — don't summarize, as details matter for synthesis.
- If the `rickydata-proxy` MCP server is not connected, Phase 2 will fail. Check: `claude mcp list | grep rickydata-proxy`
- If Phase 2 returns no results, try broader queries or use `agent_chat` for exploratory search.

## Phased Invocation

```
/research-improve                     # Full pipeline, auto-detect focus
/research-improve "query optimization" # Full pipeline, specific focus
/research-improve explore              # Phase 1 only
/research-improve discover             # Phases 1-2
/research-improve analyze              # Phases 1-2 (same as discover — extraction included)
```

## Prerequisites

The `rickydata-proxy` MCP server must be connected. Verify: `claude mcp list | grep rickydata-proxy`
If not: `rickydata mcp proxy-connect` then restart Claude Code.
