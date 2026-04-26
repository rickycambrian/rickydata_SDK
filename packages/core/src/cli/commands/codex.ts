import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { AgentClient } from '../../agent/agent-client.js';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { CliError, fail } from '../errors.js';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

function defaultCodexAuthPath(): string {
  return path.join(os.homedir(), '.codex', 'auth.json');
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function looksLikeCodexAuth(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.auth_mode === 'string'
    || (!!record.tokens && typeof record.tokens === 'object' && !Array.isArray(record.tokens))
    || record.OPENAI_API_KEY !== undefined;
}

async function confirmUpload(authPath: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `Encrypt and upload ${authPath} to the RickyData agent gateway for wallet-scoped Codex subscription use? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
      },
    );
  });
}

function makeClient(config: ConfigManager, store: CredentialStore, opts: { profile?: string; gateway?: string }): AgentClient {
  const profile = opts.profile ?? config.getActiveProfile();
  const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
  const token = requireAuth(store, profile);
  const privateKey = store.getPrivateKey(profile) ?? undefined;
  return new AgentClient({ token, privateKey, gatewayUrl });
}

export function createCodexCommands(config: ConfigManager, store: CredentialStore): Command {
  const codex = new Command('codex').description('Manage Codex subscription auth for RickyData execution');

  codex
    .command('status')
    .description('Check synced Codex subscription auth status')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        const remote = await client.getCodexAuthStatus();
        const authPath = defaultCodexAuthPath();
        const localExists = await fs.access(authPath).then(() => true).catch(() => false);

        console.log(`Remote: ${remote.configured ? chalk.green('Configured') : chalk.yellow('Not configured')}`);
        if (remote.configured) {
          if (remote.authMode) console.log(chalk.dim(`Auth mode: ${remote.authMode}`));
          console.log(chalk.dim(`Tokens present: ${remote.hasTokens ? 'yes' : 'no'}`));
          if (remote.encryptionMode) console.log(chalk.dim(`Encryption: ${remote.encryptionMode}`));
          if (remote.unlocked !== undefined) console.log(chalk.dim(`Unlocked: ${remote.unlocked ? 'yes' : 'no'}`));
          if (remote.needsMigration) console.log(chalk.yellow('Remote auth needs migration. Run `rickydata codex sync --yes`.'));
          if (remote.updatedAt) console.log(chalk.dim(`Updated: ${remote.updatedAt}`));
        }
        console.log(`Local ${authPath}: ${localExists ? chalk.green('Found') : chalk.yellow('Missing')}`);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  codex
    .command('sync')
    .description('Upload local Codex CLI auth.json for subscription-backed Codex execution')
    .option('--auth-path <path>', 'Path to Codex auth.json', defaultCodexAuthPath())
    .option('--yes', 'Confirm upload without an interactive prompt')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const authPath = path.resolve(opts.authPath as string);
      try {
        const authJson = await readJsonFile(authPath);
        if (!looksLikeCodexAuth(authJson)) {
          fail('The provided file does not look like a Codex auth.json file.');
        }
        if (!opts.yes && !await confirmUpload(authPath)) {
          fail('Upload cancelled. Re-run with --yes for non-interactive use.');
        }

        const client = makeClient(config, store, opts);
        const status = await client.setCodexAuth(authJson);
        console.log(chalk.green('Codex subscription auth encrypted and synced.'));
        console.log(chalk.dim(`Remote status: ${status.configured ? 'configured' : 'not configured'}`));
        if (status.authMode) console.log(chalk.dim(`Auth mode: ${status.authMode}`));
        if (status.encryptionMode) console.log(chalk.dim(`Encryption: ${status.encryptionMode}`));
        if (status.unlocked !== undefined) console.log(chalk.dim(`Unlocked: ${status.unlocked ? 'yes' : 'no'}`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  codex
    .command('unlock')
    .description('Unlock encrypted Codex subscription auth for the current gateway session')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        const status = await client.unlockCodexAuth();
        console.log(chalk.green('Codex subscription auth unlocked.'));
        if (status.authMode) console.log(chalk.dim(`Auth mode: ${status.authMode}`));
        if (status.encryptionMode) console.log(chalk.dim(`Encryption: ${status.encryptionMode}`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  codex
    .command('delete')
    .description('Delete synced Codex subscription auth from the gateway')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        await client.deleteCodexAuth();
        console.log(chalk.green('Codex subscription auth deleted.'));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  const openaiKey = new Command('openai-key').description('Manage OpenAI BYOK key used by Codex');

  openaiKey
    .command('status')
    .description('Check OpenAI BYOK key status')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        const status = await client.getOpenAIApiKeyStatus();
        console.log(`OpenAI BYOK: ${status.configured ? chalk.green('Configured') : chalk.yellow('Not configured')}`);
        if (status.encryptionMode) console.log(chalk.dim(`Encryption: ${status.encryptionMode}`));
        if (status.unlocked !== undefined) console.log(chalk.dim(`Unlocked: ${status.unlocked ? 'yes' : 'no'}`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  openaiKey
    .command('delete')
    .description('Delete OpenAI BYOK key so Codex uses subscription auth when synced')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        await client.deleteOpenAIApiKey();
        console.log(chalk.green('OpenAI BYOK key deleted.'));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  codex.addCommand(openaiKey);
  return codex;
}
