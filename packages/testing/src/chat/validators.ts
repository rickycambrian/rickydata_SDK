/**
 * Pure validation functions for chat test results.
 * Each returns an array of failure messages (empty = pass).
 */

import type { ChatTestResult, ChatValidationChecks } from './types.js';

/** Check that required tools were called (substring match on tool name). */
export function checkRequiredTools(result: ChatTestResult, tools: string[]): string[] {
  const failures: string[] = [];
  for (const tool of tools) {
    const found = result.toolCalls.some(tc =>
      tc.name.includes(tool) || (tc.displayName?.includes(tool) ?? false),
    );
    if (!found) {
      failures.push(`Required tool not called: "${tool}"`);
    }
  }
  return failures;
}

/** Check that expected resources (entity IDs, URLs) appear in tool results or response. */
export function checkExpectedResources(result: ChatTestResult, resources: string[]): string[] {
  const failures: string[] = [];
  const searchText = `${result.text} ${result.allToolText}`;
  for (const resource of resources) {
    if (!searchText.includes(resource)) {
      failures.push(`Expected resource not found: "${resource}"`);
    }
  }
  return failures;
}

/** Check that required keywords appear in the response (case-insensitive). */
export function checkRequiredKeywords(result: ChatTestResult, keywords: string[]): string[] {
  const failures: string[] = [];
  const lower = result.text.toLowerCase();
  for (const keyword of keywords) {
    if (!lower.includes(keyword.toLowerCase())) {
      failures.push(`Missing required keyword: "${keyword}"`);
    }
  }
  return failures;
}

/** Check that forbidden patterns do NOT appear in the response (case-insensitive). */
export function checkForbiddenPatterns(result: ChatTestResult, patterns: string[]): string[] {
  const failures: string[] = [];
  const lower = result.text.toLowerCase();
  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      failures.push(`Contains forbidden pattern: "${pattern}"`);
    }
  }
  return failures;
}

/** Check that required citations appear in the response. */
export function checkRequiredCitations(result: ChatTestResult, citations: string[]): string[] {
  const failures: string[] = [];
  const searchText = result.text;
  for (const citation of citations) {
    if (!searchText.includes(citation)) {
      failures.push(`Missing required citation: "${citation}"`);
    }
  }
  return failures;
}

/** Check that the response meets a minimum length. */
export function checkMinResponseLength(result: ChatTestResult, minLength: number): string[] {
  if (result.text.length < minLength) {
    return [`Response too short: ${result.text.length} chars (minimum: ${minLength})`];
  }
  return [];
}

/** Check that cost does not exceed maximum. */
export function checkMaxCost(result: ChatTestResult, maxCostUsd: number): string[] {
  if (result.costUsd !== undefined && result.costUsd > maxCostUsd) {
    return [`Cost $${result.costUsd.toFixed(4)} exceeds max $${maxCostUsd.toFixed(4)}`];
  }
  return [];
}

/** Run all applicable checks from a ChatValidationChecks config. */
export function runAllChecks(result: ChatTestResult, checks: ChatValidationChecks): string[] {
  const failures: string[] = [];

  if (checks.requiredTools?.length) {
    failures.push(...checkRequiredTools(result, checks.requiredTools));
  }
  if (checks.expectedResources?.length) {
    failures.push(...checkExpectedResources(result, checks.expectedResources));
  }
  if (checks.requiredKeywords?.length) {
    failures.push(...checkRequiredKeywords(result, checks.requiredKeywords));
  }
  if (checks.forbiddenPatterns?.length) {
    failures.push(...checkForbiddenPatterns(result, checks.forbiddenPatterns));
  }
  if (checks.requiredCitations?.length) {
    failures.push(...checkRequiredCitations(result, checks.requiredCitations));
  }
  if (checks.minResponseLength !== undefined) {
    failures.push(...checkMinResponseLength(result, checks.minResponseLength));
  }
  if (checks.maxCostUsd !== undefined) {
    failures.push(...checkMaxCost(result, checks.maxCostUsd));
  }
  if (checks.custom) {
    failures.push(...checks.custom(result));
  }

  return failures;
}
