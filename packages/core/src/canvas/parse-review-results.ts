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
 * Parse canvas execution result into structured findings.
 *
 * Looks for the results node output (typically keyed as 'results-1') and
 * extracts the orchestrator's JSON findings from it.
 */
export function parseCanvasReviewResult(executionResult: {
  results: Record<string, unknown>;
  events: unknown[];
}): ParsedReviewResult {
  const { results } = executionResult;

  // Find the results node output — try common keys
  let rawOutput = '';
  for (const key of ['results-1', 'results']) {
    if (results[key] != null) {
      rawOutput = typeof results[key] === 'string'
        ? results[key]
        : JSON.stringify(results[key]);
      break;
    }
  }

  // Fallback: use the first string result
  if (!rawOutput) {
    for (const val of Object.values(results)) {
      if (typeof val === 'string' && val.length > 0) {
        rawOutput = val;
        break;
      }
      if (typeof val === 'object' && val !== null) {
        rawOutput = JSON.stringify(val);
        break;
      }
    }
  }

  if (!rawOutput) {
    return { findings: [], summary: 'No results found in canvas execution output.', rawOutput: '' };
  }

  // Try to extract structured JSON
  const parsed = extractJSON(rawOutput);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const findings = Array.isArray(obj.findings) ? obj.findings as ReviewFinding[] : [];
    const summary = typeof obj.summary === 'string' ? obj.summary : '';
    return { findings, summary, rawOutput };
  }

  // Fallback: return raw output as summary with no structured findings
  return { findings: [], summary: rawOutput.slice(0, 2000), rawOutput };
}
