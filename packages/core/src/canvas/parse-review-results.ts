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
 * Parse canvas execution result into structured findings.
 *
 * Searches the results object for the orchestrator's JSON output.
 * Tries known keys first, then searches all string values recursively.
 */
export function parseCanvasReviewResult(executionResult: {
  results: Record<string, unknown>;
  events: unknown[];
}): ParsedReviewResult {
  const { results } = executionResult;

  // Collect candidate strings — try known keys first, then all values
  const candidates: string[] = [];

  // Priority keys
  for (const key of ['results-1', 'results', 'agent-team-orchestrator-1']) {
    if (results[key] != null) {
      const val = results[key];
      if (typeof val === 'string') {
        candidates.push(val);
      } else {
        candidates.push(JSON.stringify(val));
        // Also collect nested strings (e.g. { result: "..." })
        candidates.push(...collectStrings(val));
      }
    }
  }

  // Fallback: all values
  if (candidates.length === 0) {
    candidates.push(...collectStrings(results));
  }

  // Try to extract structured JSON from each candidate (longest first — most likely to contain full output)
  candidates.sort((a, b) => b.length - a.length);

  for (const candidate of candidates) {
    if (!candidate || candidate.length < 10) continue;

    const parsed = extractJSON(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.findings)) {
        const findings = obj.findings as ReviewFinding[];
        const summary = typeof obj.summary === 'string' ? obj.summary : '';
        return { findings, summary, rawOutput: candidate };
      }
    }
  }

  // No structured findings found — use the longest string as raw output
  const rawOutput = candidates[0] ?? JSON.stringify(results);
  return {
    findings: [],
    summary: rawOutput.slice(0, 2000),
    rawOutput,
  };
}
