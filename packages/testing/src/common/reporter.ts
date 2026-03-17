/**
 * Console reporter with box-drawing output for test suites.
 */

import type { TestResult, TestSummary } from './types.js';
import { formatDuration } from './timing.js';

export class ConsoleReporter {
  testStart(name: string, question?: string): void {
    console.log(`\n┌─── TEST: ${name} ───`);
    if (question) {
      console.log(`│ Question: "${question}"`);
    }
  }

  testPass(result: TestResult): void {
    const cost = result.cost ?? '?';
    console.log(
      `└─ ✅ PASSED (${formatDuration(result.elapsedMs)}, ${cost}, ${result.toolCallCount} tool calls)`,
    );
  }

  testFail(result: TestResult): void {
    const cost = result.cost ?? '?';
    console.log(`│ ❌ FAILED (${formatDuration(result.elapsedMs)}, ${cost})`);
    for (const f of result.failures) {
      console.log(`│   - ${f}`);
    }
    console.log('└───');
  }

  testError(name: string, error: Error): void {
    console.log(`│ ❌ ERROR: ${error.message}`);
    console.log('└───');
  }

  summary(summary: TestSummary): void {
    console.log('\n╔═══════════════════════════════════════════════════╗');
    console.log(
      `║ SUMMARY: ${summary.passed} passed, ${summary.failed} failed / ${summary.total} total (${formatDuration(summary.totalElapsedMs)})`,
    );
    console.log('╚═══════════════════════════════════════════════════╝');

    if (summary.failed > 0) {
      console.log('\nFailures:');
      for (const r of summary.results.filter(r => !r.passed)) {
        console.log(`  ${r.name}:`);
        for (const f of r.failures) {
          console.log(`    - ${f}`);
        }
      }
    }
  }
}
