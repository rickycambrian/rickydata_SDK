/**
 * Chat test runner — executes ChatTestCase instances against a live or mocked AgentClient.
 */

import type { TestResult, TestSummary } from '../common/types.js';
import { ConsoleReporter } from '../common/reporter.js';
import { ChatResultTracker } from './result-tracker.js';
import { runAllChecks } from './validators.js';
import type { ChatTestCase, ChatSuiteOptions } from './types.js';

/** Minimal interface for AgentClient — only what the runner needs. */
export interface ChatClient {
  chat(
    agentId: string,
    message: string,
    options?: {
      model?: 'haiku' | 'sonnet' | 'opus';
      onText?: (text: string) => void;
      onToolCall?: (tool: { name: string; displayName?: string; args: unknown }) => void;
      onToolResult?: (result: { name: string; result?: string; isError: boolean }) => void;
    },
  ): Promise<{
    text: string;
    sessionId: string;
    cost?: string;
    toolCallCount?: number;
    usage?: { inputTokens: number; outputTokens: number };
  }>;
}

export interface ChatTestRunnerConfig {
  client: ChatClient;
  reporter?: ConsoleReporter;
  /** Default model for all tests (can be overridden per test case). */
  defaultModel?: 'haiku' | 'sonnet' | 'opus';
}

export class ChatTestRunner {
  private readonly client: ChatClient;
  private readonly reporter: ConsoleReporter;
  private readonly defaultModel?: 'haiku' | 'sonnet' | 'opus';

  constructor(config: ChatTestRunnerConfig) {
    this.client = config.client;
    this.reporter = config.reporter ?? new ConsoleReporter();
    this.defaultModel = config.defaultModel;
  }

  /** Run a single test case. */
  async runTest(testCase: ChatTestCase): Promise<TestResult> {
    this.reporter.testStart(testCase.name, testCase.question);
    const tracker = new ChatResultTracker();
    const startMs = Date.now();

    try {
      const chatResult = await this.client.chat(
        testCase.agentId,
        testCase.question,
        {
          model: testCase.model ?? this.defaultModel,
          ...tracker.callbacks,
        },
      );

      const elapsedMs = Date.now() - startMs;
      const testResult = tracker.toResult(chatResult);
      const failures = runAllChecks(testResult, testCase.validation);

      const result: TestResult = {
        name: testCase.name,
        passed: failures.length === 0,
        failures,
        elapsedMs,
        cost: chatResult.cost,
        toolCallCount: testResult.toolCallCount,
        metadata: {
          sessionId: testResult.sessionId,
          usage: testResult.usage,
        },
      };

      if (result.passed) {
        this.reporter.testPass(result);
      } else {
        this.reporter.testFail(result);
      }

      return result;
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      const error = err instanceof Error ? err : new Error(String(err));
      this.reporter.testError(testCase.name, error);

      return {
        name: testCase.name,
        passed: false,
        failures: [error.message],
        elapsedMs,
        toolCallCount: tracker.toolCalls.length,
        metadata: { error: error.message },
      };
    }
  }

  /** Run a suite of test cases sequentially. */
  async runSuite(testCases: ChatTestCase[], options?: ChatSuiteOptions): Promise<TestSummary> {
    const subset = options?.subset ? testCases.slice(0, options.subset) : testCases;
    const results: TestResult[] = [];
    const suiteStart = Date.now();

    console.log(`\n═══════════════════════════════════════════════════`);
    console.log(`Running ${subset.length}/${testCases.length} test cases`);
    console.log(`═══════════════════════════════════════════════════`);

    for (const testCase of subset) {
      const result = await this.runTest(testCase);
      results.push(result);

      if (options?.stopOnFailure && !result.passed) {
        break;
      }
    }

    const summary: TestSummary = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      results,
      totalElapsedMs: Date.now() - suiteStart,
    };

    this.reporter.summary(summary);
    return summary;
  }
}
