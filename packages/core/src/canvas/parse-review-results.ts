/**
 * Parse canvas execution results into structured review findings.
 */

export interface ReviewFinding {
  severity: 'critical' | 'major' | 'minor' | 'nit' | 'praise';
  category: string;
  file: string;
  line?: number;
  title: string;
  body: string;
  suggestion?: string;
}

export interface ParsedReviewResult {
  findings: ReviewFinding[];
  summary: string;
  rawOutput: string;
}

/**
 * Extract JSON from a string that may contain markdown code fences or raw JSON.
 */
function extractJSON(text: string): unknown | null {
  // Try markdown code block first: ```json ... ``` or ``` ... ```
  const codeBlockMatch = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(text);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Try to find a JSON object directly
  const jsonMatch = /(\{[\s\S]*\})/.exec(text);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Recursively collect all string values from an object/array.
 */
function collectStrings(val: unknown): string[] {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val.flatMap(collectStrings);
  if (val && typeof val === 'object') return Object.values(val).flatMap(collectStrings);
  return [];
}

/**
 * Try to parse a findings JSON from a candidate string.
 */
function tryExtractFindings(candidate: string): { findings: ReviewFinding[]; summary: string } | null {
  if (!candidate || candidate.length < 10) return null;

  const parsed = extractJSON(candidate);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.findings)) {
      return {
        findings: obj.findings as ReviewFinding[],
        summary: typeof obj.summary === 'string' ? obj.summary : '',
      };
    }
  }
  return null;
}

interface TeamAgentEvent {
  type: 'team_agent_event';
  data: {
    agentName?: string;
    eventKind?: string;
    message?: string;
    detail?: unknown;
  };
}

function isTeamAgentEvent(event: unknown): event is TeamAgentEvent {
  return (
    event != null &&
    typeof event === 'object' &&
    (event as Record<string, unknown>).type === 'team_agent_event'
  );
}

/**
 * Parse canvas execution result into structured findings.
 *
 * The orchestrator node often returns an async-launch message, not the actual
 * findings. The real review content lives in the SSE events — specifically
 * `team_agent_event` events with `eventKind: 'agent_completed'`.
 *
 * Search order:
 * 1. Results node outputs (in case orchestrator returned JSON directly)
 * 2. Agent completed events from the SSE stream
 * 3. All agent messages from the SSE stream
 */
export function parseCanvasReviewResult(executionResult: {
  results: Record<string, unknown>;
  events: unknown[];
}): ParsedReviewResult {
  const { results, events } = executionResult;

  // ── 1. Try results node outputs first ─────────────────────────────────
  const resultCandidates: string[] = [];
  for (const key of ['results-1', 'agent-team-orchestrator-1']) {
    if (results[key] != null) {
      resultCandidates.push(...collectStrings(results[key]));
    }
  }
  // All result values
  resultCandidates.push(...collectStrings(results));

  resultCandidates.sort((a, b) => b.length - a.length);
  for (const candidate of resultCandidates) {
    const result = tryExtractFindings(candidate);
    if (result && result.findings.length > 0) {
      return { ...result, rawOutput: candidate };
    }
  }

  // ── 2. Search SSE events for team agent findings ──────────────────────
  const agentCompletedMessages: string[] = [];
  const allAgentMessages: string[] = [];

  for (const event of events) {
    if (!isTeamAgentEvent(event)) continue;

    const { eventKind, message, detail } = event.data;

    // Collect all messages
    if (message) allAgentMessages.push(message);
    if (detail) allAgentMessages.push(...collectStrings(detail));

    // Prioritize agent_completed events
    if (eventKind === 'agent_completed') {
      if (message) agentCompletedMessages.push(message);
      if (detail) agentCompletedMessages.push(...collectStrings(detail));
    }
  }

  // Try completed messages first (orchestrator's final aggregation)
  agentCompletedMessages.sort((a, b) => b.length - a.length);
  for (const candidate of agentCompletedMessages) {
    const result = tryExtractFindings(candidate);
    if (result && result.findings.length > 0) {
      return { ...result, rawOutput: candidate };
    }
  }

  // Try all agent messages
  allAgentMessages.sort((a, b) => b.length - a.length);
  for (const candidate of allAgentMessages) {
    const result = tryExtractFindings(candidate);
    if (result && result.findings.length > 0) {
      return { ...result, rawOutput: candidate };
    }
  }

  // ── 3. Fallback: use the longest text as raw output ───────────────────
  const allCandidates = [...resultCandidates, ...agentCompletedMessages, ...allAgentMessages];
  allCandidates.sort((a, b) => b.length - a.length);
  const rawOutput = allCandidates[0] ?? JSON.stringify(results);
  return {
    findings: [],
    summary: rawOutput.slice(0, 2000),
    rawOutput,
  };
}
