import * as readline from 'readline';
import chalk from 'chalk';
import { AgentClient } from '../../agent/agent-client.js';
import { FREE_TIER_MODEL } from '../../agent/types.js';
import { StreamRenderer } from './stream-renderer.js';

export interface ChatReplOptions {
  agentId: string;
  token: string;
  gatewayUrl: string;
  model?: string;
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
  let currentModel = opts.model ?? FREE_TIER_MODEL;

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
              const m = args[0];
              const VALID_MODELS = ['haiku', 'sonnet', 'opus', 'minimax'];
              if (VALID_MODELS.includes(m.toLowerCase())) {
                // Normalize: 'minimax' → FREE_TIER_MODEL for backend compatibility
                currentModel = m.toLowerCase() === 'minimax' ? FREE_TIER_MODEL : m;
                console.log(chalk.green(`Model switched to ${currentModel}`));
              } else {
                console.log(chalk.red(`Invalid model. Use: ${VALID_MODELS.join(', ')}`));
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
              '  /model <name>    — switch model (haiku|sonnet|opus|minimax)',
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

        // Contextual recovery guidance for API key / payment errors
        const lower = msg.toLowerCase();
        if (['missing_secrets', 'api key', 'apikey', '402', 'payment required', 'rate_limited'].some(p => lower.includes(p))) {
          console.error(chalk.yellow('\nThis may be a model/API key mismatch. Try one of:'));
          console.error(chalk.dim('  /model minimax       Switch to free-tier model (no API key needed)'));
          console.error(chalk.dim('  rickydata apikey set  Configure your Anthropic API key for haiku/sonnet/opus'));
        }
      }

      prompt();
    });
  };

  prompt();

  // Wait for readline to close
  await new Promise<void>((resolve) => rl.on('close', resolve));
}
