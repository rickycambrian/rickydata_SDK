import * as readline from 'readline';
import chalk from 'chalk';
import { AgentClient } from '../../agent/agent-client.js';
import { StreamRenderer } from './stream-renderer.js';

export interface ChatReplOptions {
  agentId: string;
  token: string;
  gatewayUrl: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  sessionId?: string;
  verbose?: boolean;
}

interface CostAccum {
  /** Accumulated raw cost in micro-USDC (sum of costRaw values). */
  totalRawCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalToolCalls: number;
  messageCount: number;
}

function formatTotalCost(accum: CostAccum): string {
  const usdc = accum.totalRawCost / 1_000_000;
  return `$${usdc.toFixed(6)} USDC (${accum.messageCount} message${accum.messageCount !== 1 ? 's' : ''}, ${accum.totalInputTokens} in / ${accum.totalOutputTokens} out tokens, ${accum.totalToolCalls} tool call${accum.totalToolCalls !== 1 ? 's' : ''})`;
}

export async function startChatRepl(opts: ChatReplOptions): Promise<void> {
  const client = new AgentClient({
    token: opts.token,
    gatewayUrl: opts.gatewayUrl,
  });

  const renderer = new StreamRenderer({ verbose: opts.verbose });

  const accum: CostAccum = {
    totalRawCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalToolCalls: 0,
    messageCount: 0,
  };

  let currentSessionId = opts.sessionId;
  let currentModel = opts.model ?? 'haiku';

  // Print banner
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`${chalk.bold('Agent:')} ${chalk.cyan(opts.agentId)}`);
  console.log(`${chalk.bold('Model:')} ${chalk.cyan(currentModel)}`);
  if (currentSessionId) {
    console.log(`${chalk.bold('Session:')} ${chalk.cyan(currentSessionId)}`);
  }
  console.log(chalk.dim('Type /help for commands, /exit or Ctrl+C to quit'));
  console.log(chalk.dim('─'.repeat(50)));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
  });

  let closed = false;

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    console.log('\n' + chalk.dim('Goodbye!'));
    closed = true;
    rl.close();
    process.exit(0);
  });

  rl.on('close', () => {
    closed = true;
  });

  const prompt = () => {
    if (closed) return;
    rl.question(chalk.blue('you> '), async (input) => {
      const line = input.trim();

      if (!line) {
        prompt();
        return;
      }

      // ── Slash commands ──────────────────────────────────────
      if (line.startsWith('/')) {
        const [cmd, ...args] = line.slice(1).split(/\s+/);

        switch (cmd) {
          case 'exit':
          case 'quit':
            console.log(chalk.dim('Goodbye!'));
            rl.close();
            return;

          case 'session':
            if (currentSessionId) {
              console.log(`Session: ${chalk.cyan(currentSessionId)}`);
            } else {
              console.log(chalk.yellow('No session started yet — send a message first.'));
            }
            break;

          case 'model':
            if (args[0]) {
              const m = args[0] as 'haiku' | 'sonnet' | 'opus';
              if (!['haiku', 'sonnet', 'opus'].includes(m)) {
                console.log(chalk.red('Invalid model. Use: haiku, sonnet, opus'));
              } else {
                currentModel = m;
                console.log(chalk.green(`Model switched to ${m}`));
              }
            } else {
              console.log(`Current model: ${chalk.cyan(currentModel)}`);
            }
            break;

          case 'cost':
            console.log(formatTotalCost(accum));
            break;

          case 'history':
            console.log(chalk.dim(`Session history is stored server-side. Use \`rickydata sessions get ${currentSessionId ?? '<session-id>'}\` to view.`));
            break;

          case 'help':
            console.log(chalk.dim([
              '  /session         — show current session ID',
              '  /model <name>    — switch model (haiku|sonnet|opus)',
              '  /cost            — show accumulated session cost',
              '  /history         — view session history',
              '  /exit            — exit chat',
            ].join('\n')));
            break;

          default:
            console.log(chalk.yellow(`Unknown command: /${cmd}. Type /help for commands.`));
        }

        prompt();
        return;
      }

      // ── Send message ────────────────────────────────────────
      try {
        renderer.reset();

        const result = await client.chat(opts.agentId, line, {
          model: currentModel,
          sessionId: currentSessionId,
          onText: (t) => renderer.onText(t),
          onToolCall: (tc) => renderer.onToolCall(tc),
          onToolResult: (tr) => renderer.onToolResult(tr),
        });

        // Update session ID from first response
        if (!currentSessionId && result.sessionId) {
          currentSessionId = result.sessionId;
        }

        renderer.onDone({
          cost: result.cost,
          toolCallCount: result.toolCallCount,
          usage: result.usage,
        });

        // Accumulate cost
        accum.messageCount++;
        accum.totalToolCalls += result.toolCallCount ?? 0;
        if (result.usage) {
          accum.totalInputTokens += result.usage.inputTokens;
          accum.totalOutputTokens += result.usage.outputTokens;
        }
        // Parse cost string like "$0.014" → micro-USDC
        if (result.cost) {
          const usdcMatch = result.cost.match(/\$?([\d.]+)/);
          if (usdcMatch) {
            accum.totalRawCost += Math.round(parseFloat(usdcMatch[1]) * 1_000_000);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!currentSessionId) {
          const cachedSessionId = client.getCachedSessionId(opts.agentId);
          if (cachedSessionId) {
            currentSessionId = cachedSessionId;
            console.error(chalk.yellow(`\nSession created before interruption: ${cachedSessionId}`));
            console.error(chalk.dim('Use /session to view it, then retry or resume.'));
          }
        }
        console.error(chalk.red(`\nError: ${msg}`));
      }

      prompt();
    });
  };

  prompt();

  // Wait for readline to close
  await new Promise<void>((resolve) => rl.on('close', resolve));
}
