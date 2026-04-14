import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatOutput, formatJson, formatKeyValue, type OutputFormat } from '../output/formatter.js';
import { CliError, fail } from '../errors.js';

const ALLOWED_SETTINGS_KEYS = new Set([
  'defaultModel',
  'modelProvider',
  'plan',
  'persistConversations',
  'conversationRetentionDays',
  'autoImprove',
  'postToKnowledgeBook',
  'agentAutoImprove',
  'selfImprovementSchedule',
  'selfImprovementScope',
]);

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function parseSettingValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through and keep original string when JSON parsing fails.
    }
  }

  return value;
}

function validateWalletSettingKey(key: string): void {
  if (ALLOWED_SETTINGS_KEYS.has(key)) {
    return;
  }

  fail(
    `Unknown wallet setting '${key}'. Allowed keys: ${Array.from(ALLOWED_SETTINGS_KEYS).join(', ')}`
  );
}

/* ── transaction formatting helpers ───────────────────────── */

const USDC_DECIMALS = 6;

/** Parse a raw amount value to USD. Handles both base-unit integers and pre-formatted decimals. */
function parseTxUsd(raw: unknown): number {
  if (raw == null) return 0;
  const s = String(raw);
  if (s.includes('.')) return parseFloat(s) || 0;
  // Pure integer string → USDC base units (6 decimals)
  const n = Number(s);
  if (Number.isFinite(n) && n !== 0) return n / 10 ** USDC_DECIMALS;
  return 0;
}

/** Format a raw amount to USD string. */
function formatTxUsd(raw: unknown): string {
  const usd = parseTxUsd(raw);
  if (usd === 0) return '—';
  return `$${usd.toFixed(4)}`;
}

/** Format amount with sign and color based on transaction type. */
function formatTxAmount(raw: unknown, type: string): string {
  const usd = parseTxUsd(raw);
  if (usd === 0) return '—';
  const isCredit = type === 'deposit_detected' || type === 'deposit' || type === 'settlement' || type === 'admin_reset';
  const sign = isCredit ? '+' : '-';
  const formatted = `${sign}$${usd.toFixed(4)}`;
  return isCredit ? chalk.green(formatted) : chalk.red(formatted);
}

/** Format a transaction type with color coding. */
function formatTxType(type: string): string {
  switch (type) {
    case 'spend': return chalk.red(type);
    case 'deposit_detected': return chalk.green('deposit');
    case 'deposit': return chalk.green(type);
    case 'settlement': return chalk.blue(type);
    case 'withdrawal': return chalk.yellow(type);
    case 'legacy_sweep': return chalk.dim('sweep');
    case 'admin_reset': return chalk.magenta('reset');
    default: return type;
  }
}

/** Format a timestamp or date string to human-readable short form. */
function formatTxDate(raw: unknown): string {
  if (raw == null || raw === '') return '—';
  let d: Date;
  if (typeof raw === 'number') {
    d = new Date(raw);
  } else {
    const s = String(raw);
    const parsed = Date.parse(s);
    if (Number.isNaN(parsed)) return s;
    d = new Date(parsed);
  }
  if (Number.isNaN(d.getTime())) return String(raw);
  // "Mar 4 15:45" — compact and readable
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hr = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${mon} ${day} ${hr}:${min}`;
}

function formatEstimatedMessageModel(model: string): string {
  return model
    .replace(/^claude-/, '')
    .replace(/^openclaude-/, '')
    .replace(/-\d+.*/, '');
}

export function createWalletCommands(config: ConfigManager, store: CredentialStore): Command {
  const wallet = new Command('wallet').description('Manage wallet balance and transactions');

  // wallet balance
  wallet
    .command('balance')
    .description('Show USDC balance and deposit address')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const res = await fetch(`${gatewayUrl}/wallet/balance`, {
          headers: authHeaders(token),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const data = await res.json();

        if (format === 'json') {
          console.log(formatJson(data));
          return;
        }

        const displayData: Record<string, unknown> = {
          'Balance (USDC)': data.availableBalanceUsd ?? data.balance ?? data.usdc ?? '—',
          'Deposit Address': data.unifiedDepositAddress ?? data.depositAddress ?? data.address ?? '—',
          'Wallet Address': data.walletAddress ?? '—',
        };
        if (data.estimatedMessages !== undefined) {
          const em = data.estimatedMessages as Record<string, number> | number;
          if (typeof em === 'object') {
            const parts = Object.entries(em)
              .map(([model, count]) => `${count} (${formatEstimatedMessageModel(model)})`)
              .join(', ');
            displayData['Est. Messages'] = parts;
          } else {
            displayData['Est. Messages'] = String(em);
          }
        }
        // Parse balance as number (strip $ prefix if present)
        const balanceStr = String(data.availableBalanceUsd ?? data.balance ?? data.usdc ?? '0').replace(/^\$/, '');
        const balance = parseFloat(balanceStr) || 0;
        const depositAddr = data.unifiedDepositAddress ?? data.depositAddress ?? data.address ?? '';

        // Always show network
        displayData['Network'] = 'Base Mainnet (Chain 8453) — USDC only';

        console.log(formatKeyValue(displayData));

        // Balance warnings
        if (balance === 0) {
          console.log();
          console.log(chalk.red.bold('⚠ Zero balance — you cannot call MCP tools or use agents'));
          console.log();
          console.log(chalk.white('To fund your wallet:'));
          console.log(chalk.white(`  1. Send USDC on Base mainnet to: ${chalk.cyan(depositAddr)}`));
          console.log(chalk.white('  2. Or deposit via: ') + chalk.cyan('https://marketplace.rickydata.org/#/wallet'));
          console.log();
          console.log(chalk.yellow('Important: Send ONLY USDC on Base mainnet (Chain 8453)'));
          console.log(chalk.yellow('Other networks are NOT auto-credited. Recovery policy applies.'));
        } else if (balance < 1.0) {
          console.log();
          console.log(chalk.yellow(`⚠ Low balance: $${balance.toFixed(4)} USDC`));
          console.log(chalk.dim(`  Each MCP tool call costs $0.0005. Agent chat: 10% markup on LLM cost.`));
          console.log(chalk.dim(`  Fund at: https://marketplace.rickydata.org/#/wallet`));
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // wallet transactions
  wallet
    .command('transactions')
    .description('List recent transactions')
    .option('--limit <n>', 'Max transactions to show', '20')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;
      const limit = parseInt(opts.limit, 10);

      try {
        const res = await fetch(
          `${gatewayUrl}/wallet/transactions?limit=${limit}`,
          { headers: authHeaders(token) }
        );
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const data = await res.json();
        const txList: unknown[] = data.transactions ?? data.items ?? [];

        if (format === 'json') {
          console.log(formatJson(txList));
          return;
        }

        if (txList.length === 0) {
          console.log(chalk.yellow('No transactions found.'));
          return;
        }

        const rows = txList.map((tx) => {
          const t = tx as Record<string, unknown>;
          return {
            date: formatTxDate(t.createdAt ?? t.timestamp),
            type: formatTxType(String(t.type ?? t.kind ?? '')),
            amount: formatTxAmount(t.amount ?? t.usdc, String(t.type ?? t.kind ?? '')),
            agent: t.agentId ? String(t.agentId).slice(0, 12) : '—',
            details: String(t.details ?? t.status ?? '—'),
            tools: t.toolCallCount != null ? String(t.toolCallCount) : '—',
            balance: formatTxUsd(t.balance),
          };
        });

        console.log(
          formatOutput(rows, [
            { header: 'Date', key: 'date', width: 20 },
            { header: 'Type', key: 'type', width: 18 },
            { header: 'Amount', key: 'amount', width: 14 },
            { header: 'Agent', key: 'agent', width: 14 },
            { header: 'Details', key: 'details', width: 14 },
            { header: 'Tools', key: 'tools', width: 7 },
            { header: 'Balance', key: 'balance', width: 14 },
          ], format)
        );

        // Summary line
        const spendTxs = txList.filter((tx) => {
          const t = tx as Record<string, unknown>;
          return String(t.type ?? t.kind ?? '') === 'spend';
        });
        const totalSpend: number = spendTxs.reduce<number>((sum, tx) => {
          const t = tx as Record<string, unknown>;
          return sum + parseTxUsd(t.amount ?? t.usdc);
        }, 0);

        const parts = [`${txList.length} transaction(s)`];
        if (totalSpend > 0) parts.push(`total spend: $${totalSpend.toFixed(4)}`);
        if (data.hasMore) parts.push('use --limit to see more');
        console.log(chalk.dim(`\n${parts.join(' · ')}`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // wallet settings
  const settingsCmd = new Command('settings').description('View or update wallet settings');

  settingsCmd
    .command('show', { isDefault: true })
    .description('Show current wallet settings')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const res = await fetch(`${gatewayUrl}/wallet/settings`, {
          headers: authHeaders(token),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const data = await res.json();

        if (format === 'json') {
          console.log(formatJson(data));
          return;
        }

        const displayData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
          displayData[k] = v;
        }
        console.log(formatKeyValue(displayData));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  settingsCmd
    .command('set <key> <value>')
    .description('Update a wallet setting')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (key: string, value: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        validateWalletSettingKey(key);
        const parsedValue = parseSettingValue(value);
        const res = await fetch(`${gatewayUrl}/wallet/settings`, {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({ [key]: parsedValue }),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        console.log(chalk.green(`Setting '${key}' updated to '${String(parsedValue)}'`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  wallet.addCommand(settingsCmd);

  return wallet;
}
