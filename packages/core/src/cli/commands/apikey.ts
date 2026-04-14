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

async function signToDeriveApiKey(
  gatewayUrl: string, token: string, privateKey: string, anthropicApiKey: string,
): Promise<{ encryptionMode: string }> {
  const { privateKeyToAccount } = await import('viem/accounts');
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);

  // 1. Fetch derive-challenge
  const challengeRes = await fetch(`${gatewayUrl}/wallet/apikey/derive-challenge`, {
    headers: authHeaders(token),
  });
  if (!challengeRes.ok) {
    throw new Error(`derive-challenge failed: ${challengeRes.status} ${await challengeRes.text()}`);
  }
  const { message, nonce } = await challengeRes.json() as { message: string; nonce: string };

  // 2. Sign the deterministic message
  const signature = await account.signMessage({ message });

  // 3. Store with S2D encryption
  const res = await fetch(`${gatewayUrl}/wallet/apikey`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ anthropicApiKey, signature, nonce }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { encryptionMode?: string };
  return { encryptionMode: data.encryptionMode ?? 'sign-to-derive' };
}

function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);

    const input: string[] = [];

    if (!process.stdin.isTTY) {
      // Non-interactive: fall back to readline (no masking)
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', (answer) => { rl.close(); resolve(answer); });
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (chunk: string) => {
      // Iterate each character (handles paste events with multiple chars)
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);

        if (ch === '\r' || ch === '\n') {
          // Enter pressed
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input.join(''));
          return;
        } else if (code === 3) {
          // Ctrl+C
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.exit(0);
        } else if (code === 127 || code === 8) {
          // Backspace
          if (input.length > 0) {
            input.pop();
            process.stdout.write('\b \b');
          }
        } else if (code >= 32) {
          // Printable character
          input.push(ch);
          process.stdout.write('*');
        }
      }
    };

    process.stdin.on('data', onData);
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
        const privateKey = store.getPrivateKey(profile);

        if (privateKey) {
          // S2D path — zero-knowledge encryption
          const result = await signToDeriveApiKey(gatewayUrl, token, privateKey, apiKey);
          console.log(chalk.green('Anthropic API key configured with zero-knowledge encryption.'));
          console.log(chalk.dim(`Encryption: ${result.encryptionMode}`));
          console.log(chalk.dim('BYOK pricing is now active (10% markup only).'));
        } else {
          // HKDF fallback for browser-auth users
          const res = await fetch(`${gatewayUrl}/wallet/apikey`, {
            method: 'PUT',
            headers: authHeaders(token),
            body: JSON.stringify({ anthropicApiKey: apiKey }),
          });
          if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
          console.log(chalk.green('Anthropic API key configured successfully.'));
          console.log(chalk.dim('BYOK pricing is now active (10% markup only).'));
          console.log(chalk.yellow(
            'Tip: Use `rickydata auth login --private-key` to enable zero-knowledge encryption.'
          ));
        }
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
