import { describe, it, expect } from 'vitest';
import {
  checkRequiredTools,
  checkExpectedResources,
  checkRequiredKeywords,
  checkForbiddenPatterns,
  checkRequiredCitations,
  checkMinResponseLength,
  checkMaxCost,
  runAllChecks,
} from '../src/chat/validators.js';
import type { ChatTestResult } from '../src/chat/types.js';

function makeResult(overrides: Partial<ChatTestResult> = {}): ChatTestResult {
  return {
    text: 'Geo governance has personal, public, editor, and voting roles.',
    sessionId: 'sess-1',
    cost: '$0.014',
    costUsd: 0.014,
    toolCallCount: 1,
    toolCalls: [{ name: 'mcp__geo__get_page_content', displayName: 'Get Page Content', args: {} }],
    toolResults: [{ name: 'mcp__geo__get_page_content', result: 'entity-id-abc123', isError: false }],
    allToolText: 'entity-id-abc123 governance roles personal public editor',
    ...overrides,
  };
}

describe('checkRequiredTools', () => {
  it('passes when required tool was called', () => {
    expect(checkRequiredTools(makeResult(), ['get_page_content'])).toEqual([]);
  });

  it('fails when required tool was not called', () => {
    const failures = checkRequiredTools(makeResult(), ['brave_search']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('brave_search');
  });

  it('matches on displayName too', () => {
    expect(checkRequiredTools(makeResult(), ['Get Page'])).toEqual([]);
  });
});

describe('checkExpectedResources', () => {
  it('passes when resource found in tool results', () => {
    expect(checkExpectedResources(makeResult(), ['entity-id-abc123'])).toEqual([]);
  });

  it('passes when resource found in response text', () => {
    const r = makeResult({ text: 'See entity-xyz for details.' });
    expect(checkExpectedResources(r, ['entity-xyz'])).toEqual([]);
  });

  it('fails when resource not found', () => {
    const failures = checkExpectedResources(makeResult(), ['missing-entity']);
    expect(failures).toHaveLength(1);
  });
});

describe('checkRequiredKeywords', () => {
  it('passes with case-insensitive match', () => {
    expect(checkRequiredKeywords(makeResult(), ['Personal', 'PUBLIC'])).toEqual([]);
  });

  it('fails when keyword missing', () => {
    const failures = checkRequiredKeywords(makeResult(), ['bounties']);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('bounties');
  });
});

describe('checkForbiddenPatterns', () => {
  it('passes when no forbidden patterns found', () => {
    expect(checkForbiddenPatterns(makeResult(), ["I don't have"])).toEqual([]);
  });

  it('fails when forbidden pattern found', () => {
    const r = makeResult({ text: "I don't have specific information about that." });
    const failures = checkForbiddenPatterns(r, ["I don't have"]);
    expect(failures).toHaveLength(1);
  });
});

describe('checkRequiredCitations', () => {
  it('passes when citation found', () => {
    const r = makeResult({ text: 'According to the Governance page...' });
    expect(checkRequiredCitations(r, ['Governance'])).toEqual([]);
  });

  it('fails when citation missing', () => {
    const failures = checkRequiredCitations(makeResult(), ['Bounties']);
    expect(failures).toHaveLength(1);
  });
});

describe('checkMinResponseLength', () => {
  it('passes when response is long enough', () => {
    expect(checkMinResponseLength(makeResult(), 10)).toEqual([]);
  });

  it('fails when response is too short', () => {
    const r = makeResult({ text: 'Hi' });
    const failures = checkMinResponseLength(r, 100);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('too short');
  });
});

describe('checkMaxCost', () => {
  it('passes when cost is within limit', () => {
    expect(checkMaxCost(makeResult(), 1.0)).toEqual([]);
  });

  it('fails when cost exceeds limit', () => {
    const failures = checkMaxCost(makeResult(), 0.01);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('exceeds');
  });

  it('passes when cost is undefined', () => {
    const r = makeResult({ costUsd: undefined });
    expect(checkMaxCost(r, 0.01)).toEqual([]);
  });
});

describe('runAllChecks', () => {
  it('aggregates failures from multiple checks', () => {
    const r = makeResult({ text: 'short' });
    const failures = runAllChecks(r, {
      requiredKeywords: ['missing_word'],
      minResponseLength: 200,
    });
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array when all checks pass', () => {
    const failures = runAllChecks(makeResult(), {
      requiredTools: ['get_page_content'],
      requiredKeywords: ['governance'],
    });
    expect(failures).toEqual([]);
  });

  it('runs custom validator', () => {
    const failures = runAllChecks(makeResult(), {
      custom: (r) => r.toolCallCount === 0 ? ['No tool calls'] : [],
    });
    expect(failures).toEqual([]);
  });
});
