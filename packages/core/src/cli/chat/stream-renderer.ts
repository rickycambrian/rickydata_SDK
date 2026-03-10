import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export interface RenderOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export interface RenderResult {
  text: string;
  cost?: string;
  toolCallCount?: number;
  usage?: { inputTokens: number; outputTokens: number };
  sessionCostAccum?: number;
}

/**
 * StreamRenderer renders agent SSE output to the terminal in real time.
 *
 * Usage:
 *   const renderer = new StreamRenderer({ verbose });
 *   const onText = (t) => renderer.onText(t);
 *   const onToolCall = (tc) => renderer.onToolCall(tc);
 *   const onToolResult = (tr) => renderer.onToolResult(tr);
 *   // pass these as callbacks to AgentClient.chat()
 *   renderer.onDone({ cost, toolCallCount, usage });
 */
export class StreamRenderer {
  private readonly verbose: boolean;
  private readonly quiet: boolean;
  private activeSpinner: Ora | null = null;
  private currentTool: string | null = null;
  private textStarted = false;

  constructor(opts: RenderOptions = {}) {
    this.verbose = opts.verbose ?? false;
    this.quiet = opts.quiet ?? false;
  }

  /** Called by the AgentClient onText callback — writes text immediately to stdout. */
  onText(chunk: string): void {
    // If a tool spinner was active, stop it cleanly first
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = null;
      this.currentTool = null;
      process.stdout.write('\n');
    }
    if (!this.textStarted) {
      process.stdout.write(chalk.green('agent> '));
      this.textStarted = true;
    }
    process.stdout.write(chunk);
  }

  /** Called by the AgentClient onToolCall callback. */
  onToolCall(tool: { name: string; displayName?: string; args: unknown }): void {
    // End any pending text line
    if (this.textStarted) {
      process.stdout.write('\n');
      this.textStarted = false;
    }
    if (this.activeSpinner) {
      this.activeSpinner.stop();
    }

    const displayName = tool.displayName ?? tool.name;
    this.currentTool = tool.name;

    if (this.verbose) {
      process.stdout.write(chalk.dim(`  [tool: ${displayName}] `));
      process.stdout.write(chalk.dim(JSON.stringify(tool.args)) + '\n');
      this.activeSpinner = null;
    } else {
      this.activeSpinner = ora({
        text: chalk.dim(`[tool: ${displayName}]`),
        spinner: 'dots',
        color: 'gray',
      }).start();
    }
  }

  /** Called by the AgentClient onToolResult callback. */
  onToolResult(result: { name: string; result?: string; isError: boolean }): void {
    if (this.activeSpinner) {
      if (result.isError) {
        this.activeSpinner.fail(chalk.dim(`[tool: ${this.currentTool ?? result.name}] error`));
      } else {
        this.activeSpinner.succeed(chalk.dim(`[tool: ${this.currentTool ?? result.name}]`));
      }
      this.activeSpinner = null;
      this.currentTool = null;
    }

    if (this.verbose && result.result) {
      const preview = result.result.length > 200 ? result.result.slice(0, 200) + '…' : result.result;
      process.stdout.write(chalk.dim(`    → ${preview}\n`));
    }
  }

  /** Call after the full response is received. */
  onDone(data: {
    cost?: string;
    toolCallCount?: number;
    usage?: { inputTokens: number; outputTokens: number };
  }): void {
    // Close out any pending spinner
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = null;
    }

    // End text line
    if (this.textStarted) {
      process.stdout.write('\n');
      this.textStarted = false;
    }

    if (!this.quiet) {
      const parts: string[] = [];
      if (data.cost) parts.push(data.cost);
      if (data.usage) {
        parts.push(`${data.usage.inputTokens} in / ${data.usage.outputTokens} out tokens`);
      }
      if (data.toolCallCount && data.toolCallCount > 0) {
        parts.push(`${data.toolCallCount} tool call${data.toolCallCount > 1 ? 's' : ''}`);
      }
      if (parts.length > 0) {
        process.stdout.write(chalk.dim(`(${parts.join(', ')})\n`));
      }
    }
  }

  /** Reset state between messages. */
  reset(): void {
    if (this.activeSpinner) {
      this.activeSpinner.stop();
      this.activeSpinner = null;
    }
    this.currentTool = null;
    this.textStarted = false;
  }
}
