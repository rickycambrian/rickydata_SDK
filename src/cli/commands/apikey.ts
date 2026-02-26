import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
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

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // Suppress echo for secret input
    const origWrite = (rl as unknown as { output: NodeJS.WritableStream }).output.write.bind(
      (rl as unknown as { output: NodeJS.WritableStream }).output
    );
    (rl as unknown as { output: { write: (s: string) => void } }).output.write = (s: string) => {
      if (s === question || !s.trim()) (origWrite as (s: string) => void)(s);
    };
    rl.question(question, (answer) => {
      (origWrite as (s: string) => void)('\n');
      rl.close();
      resolve(answer);
    });
  });
}

export function createApiKeyCommands(config: ConfigManager, store: CredentialStore): Command {
  const apikey = new Command('apikey').description('Manage BYOK Anthropic API key');

  // apikey set [--key sk-ant-...]
  apikey
    .command('set')
    .description('Store an Anthropic API key for BYOK pricing')
    .option('--key <key>', 'API key (sk-ant-...)')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      let apiKey = opts.key as string | undefined;
      if (!apiKey) {
        apiKey = await promptSecret('Enter Anthropic API key (sk-ant-...): ');
      }
      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        fail('Invalid API key: must start with sk-ant-');
      }

      try {
        const res = await fetch(`${gatewayUrl}/wallet/apikey`, {
          method: 'PUT',
          headers: authHeaders(token),
          body: JSON.stringify({ anthropicApiKey: apiKey }),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        console.log(chalk.green('Anthropic API key configured successfully.'));
        console.log(chalk.dim('BYOK pricing is now active (10% markup only).'));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // apikey status
  apikey
    .command('status')
    .description('Check if an API key is configured')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        const res = await fetch(`${gatewayUrl}/wallet/apikey/status`, {
          headers: authHeaders(token),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        const data = await res.json();

        if (data.configured) {
          console.log(`Status: ${chalk.green('Configured')}`);
          console.log(chalk.dim('BYOK pricing is active (10% markup only).'));
        } else {
          console.log(`Status: ${chalk.yellow('Not configured')}`);
          console.log(chalk.dim('Using standard pricing. Run `rickydata apikey set` to enable BYOK.'));
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // apikey delete
  apikey
    .command('delete')
    .description('Remove stored Anthropic API key')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        const res = await fetch(`${gatewayUrl}/wallet/apikey`, {
          method: 'DELETE',
          headers: authHeaders(token),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        console.log(chalk.green('Anthropic API key removed.'));
        console.log(chalk.dim('Standard pricing is now active.'));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return apikey;
}
