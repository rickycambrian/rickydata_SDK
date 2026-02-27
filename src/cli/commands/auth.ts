import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { CliError, fail } from '../errors.js';

type WalletTokenStage = 'token-message' | 'create-token';

class WalletTokenRequestError extends Error {
  status: number;
  stage: WalletTokenStage;

  constructor(stage: WalletTokenStage, status: number, message: string) {
    super(message);
    this.name = 'WalletTokenRequestError';
    this.status = status;
    this.stage = stage;
  }
}

function isWalletTokenEndpointUnavailable(error: unknown): boolean {
  if (error instanceof WalletTokenRequestError) {
    return error.status === 404 || error.status === 405 || error.status === 501 || error.status === 503;
  }
  return false;
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

async function runAuthChallenge(
  gatewayUrl: string,
  privateKey: string,
): Promise<{ token: string; walletAddress: string }> {
  const { privateKeyToAccount } = await import('viem/accounts');

  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);

  // 1. Get challenge
  const challengeRes = await fetch(`${gatewayUrl}/auth/challenge`);
  if (!challengeRes.ok) {
    throw new Error(`Auth challenge failed: ${challengeRes.status} ${await challengeRes.text()}`);
  }
  const { nonce, message: challengeMessage } = await challengeRes.json();

  // 2. Sign
  const signature = await account.signMessage({ message: challengeMessage });

  // 3. Verify
  const verifyRes = await fetch(`${gatewayUrl}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: account.address, signature, nonce }),
  });
  if (!verifyRes.ok) {
    throw new Error(`Auth verification failed: ${verifyRes.status} ${await verifyRes.text()}`);
  }
  const { token } = await verifyRes.json();
  return { token, walletAddress: account.address };
}

async function createWalletTokenFlow(
  gatewayUrl: string,
  privateKey: string,
  expiresAt: string,
): Promise<{ token: string; walletAddress: string; expiresAt: string }> {
  const { privateKeyToAccount } = await import('viem/accounts');

  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);

  // 1. Get token message
  const msgRes = await fetch(
    `${gatewayUrl}/api/auth/token-message?walletAddress=${encodeURIComponent(account.address)}&expiresAt=${encodeURIComponent(expiresAt)}`
  );
  if (!msgRes.ok) {
    throw new WalletTokenRequestError(
      'token-message',
      msgRes.status,
      `Token message failed: ${msgRes.status} ${await msgRes.text()}`,
    );
  }
  const { message } = await msgRes.json();

  // 2. Sign
  const signature = await account.signMessage({ message });

  // 3. Create token
  const tokenRes = await fetch(`${gatewayUrl}/api/auth/create-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: account.address, signature, expiresAt }),
  });
  if (!tokenRes.ok) {
    throw new WalletTokenRequestError(
      'create-token',
      tokenRes.status,
      `Token creation failed: ${tokenRes.status} ${await tokenRes.text()}`,
    );
  }
  return tokenRes.json();
}

async function runPrivyExchange(
  gatewayUrl: string,
  privyAccessToken: string,
  requestedWalletAddress?: string,
): Promise<{ token: string; walletAddress: string; expiresAt: number }> {
  const body: Record<string, string> = { privyAccessToken };
  if (requestedWalletAddress) {
    body.requestedWalletAddress = requestedWalletAddress;
  }

  const res = await fetch(`${gatewayUrl}/auth/privy/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorBody.message || errorBody.error || `Privy exchange failed: ${res.status}`);
  }

  return res.json();
}

export function createAuthCommands(config: ConfigManager, store: CredentialStore): Command {
  const auth = new Command('auth').description('Authenticate with the agent gateway');

  // auth login
  auth
    .command('login')
    .description('Log in via browser, Privy, or wallet private key')
    .option('--private-key <key>', 'Private key (0x-prefixed or raw hex)')
    .option('--token <token>', 'Use a pre-existing wallet token (mcpwt_...)')
    .option('--privy [token]', 'Authenticate via Privy access token (paste token or be prompted)')
    .option('--wallet <address>', 'Request a specific wallet address (with --privy)')
    .option('--profile <profile>', 'Profile to store credentials in')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');

      // Direct token path
      if (opts.token) {
        if (!opts.token.startsWith('mcpwt_')) {
          fail('Token must start with mcpwt_');
        }
        let walletAddress = '(unknown)';
        let expiresAtIso: string | undefined;
        try {
          const payload = JSON.parse(
            Buffer.from(opts.token.slice('mcpwt_'.length), 'base64url').toString()
          );
          if (payload.wallet) walletAddress = payload.wallet;
          if (payload.exp) expiresAtIso = new Date(payload.exp * 1000).toISOString();
        } catch {
          // Malformed payload — store anyway with unknown wallet
        }
        store.setToken(opts.token, walletAddress, profile, expiresAtIso);
        console.log(chalk.green('Token stored successfully.'));
        if (walletAddress !== '(unknown)') {
          console.log(`  Wallet:  ${chalk.cyan(walletAddress)}`);
        }
        if (expiresAtIso) {
          console.log(`  Expires: ${chalk.cyan(expiresAtIso)}`);
        }
        console.log(chalk.dim(`Profile: ${profile}`));
        return;
      }

      // Browser-based login (default path when no auth method flag is provided)
      if (!opts.token && opts.privy === undefined && !opts.privateKey) {
        const marketplaceUrl = 'https://mcpmarketplace.rickydata.org/#/auth/cli';

        console.log(chalk.cyan('Opening browser for sign-in...'));
        console.log(chalk.dim(`If the browser doesn't open, visit: ${marketplaceUrl}`));
        console.log();

        // Try to open browser
        try {
          const { default: open } = await import('open');
          await open(marketplaceUrl);
        } catch {
          console.log(chalk.yellow(`Open this URL in your browser:`));
          console.log(chalk.cyan(marketplaceUrl));
          console.log();
        }

        console.log(chalk.dim('After signing in, copy the token shown on the page.'));
        const pastedToken = await promptSecret('Paste your token here: ');

        if (!pastedToken) {
          fail('No token provided.');
        }

        // Validate token format
        if (!pastedToken.startsWith('eyJ') && !pastedToken.startsWith('mcpwt_')) {
          fail('Invalid token format. Expected a JWT (eyJ...) or wallet token (mcpwt_...).');
        }

        // For JWTs, try to extract wallet address and expiry from payload
        let walletAddress = '(unknown)';
        let expiresAtIso: string | undefined;

        if (pastedToken.startsWith('eyJ')) {
          try {
            const payload = JSON.parse(
              Buffer.from(pastedToken.split('.')[1], 'base64url').toString()
            );
            if (payload.walletAddress) walletAddress = payload.walletAddress;
            if (payload.expiresAt) expiresAtIso = new Date(payload.expiresAt).toISOString();
            else if (payload.exp) expiresAtIso = new Date(payload.exp * 1000).toISOString();
          } catch {
            // JWT decode failed — store anyway
          }
        } else if (pastedToken.startsWith('mcpwt_')) {
          try {
            const payload = JSON.parse(
              Buffer.from(pastedToken.slice('mcpwt_'.length), 'base64url').toString()
            );
            if (payload.wallet) walletAddress = payload.wallet;
            if (payload.exp) expiresAtIso = new Date(payload.exp * 1000).toISOString();
          } catch {
            walletAddress = '(wallet-token)';
          }
        }

        store.setToken(pastedToken, walletAddress, profile, expiresAtIso);
        console.log(chalk.green('✓ Logged in successfully'));
        if (walletAddress !== '(unknown)' && walletAddress !== '(wallet-token)') {
          console.log(`  Wallet:  ${chalk.cyan(walletAddress)}`);
        }
        if (expiresAtIso) {
          console.log(`  Expires: ${chalk.cyan(expiresAtIso)}`);
        }
        console.log(`  Profile: ${chalk.cyan(profile)}`);
        return;
      }

      // Privy token exchange path
      if (opts.privy !== undefined) {
        let privyToken = typeof opts.privy === 'string' ? opts.privy : '';
        if (!privyToken) {
          privyToken = await promptSecret('Enter Privy access token: ');
        }
        if (!privyToken) {
          fail('Privy access token is required.');
        }

        const spinner = ora('Exchanging Privy token...').start();
        try {
          const result = await runPrivyExchange(gatewayUrl, privyToken, opts.wallet);
          const expiresAtIso = new Date(result.expiresAt).toISOString();
          store.setToken(result.token, result.walletAddress, profile, expiresAtIso);
          spinner.succeed(chalk.green('Authenticated via Privy'));
          console.log(`  Wallet:  ${chalk.cyan(result.walletAddress)}`);
          console.log(`  Expires: ${chalk.cyan(expiresAtIso)}`);
          console.log(`  Profile: ${chalk.cyan(profile)}`);
        } catch (err) {
          spinner.fail(chalk.red('Privy authentication failed'));
          throw new CliError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      let privateKey = opts.privateKey;
      if (!privateKey) {
        privateKey = await promptSecret('Enter private key: ');
      }
      if (!privateKey) {
        fail('Private key is required.');
      }

      const spinner = ora('Authenticating...').start();
      try {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        try {
          const tokenResult = await createWalletTokenFlow(gatewayUrl, privateKey, expiresAt);
          store.setToken(tokenResult.token, tokenResult.walletAddress, profile, tokenResult.expiresAt);
          store.setPrivateKey(privateKey, profile);
          spinner.succeed(chalk.green('Authenticated successfully (wallet token)'));
          console.log(`  Wallet: ${chalk.cyan(tokenResult.walletAddress)}`);
          console.log(`  Expires: ${chalk.cyan(tokenResult.expiresAt)}`);
          console.log(`  Profile: ${chalk.cyan(profile)}`);
          return;
        } catch (walletTokenErr) {
          if (!isWalletTokenEndpointUnavailable(walletTokenErr)) {
            throw walletTokenErr;
          }
        }

        const challengeResult = await runAuthChallenge(gatewayUrl, privateKey);
        store.setToken(challengeResult.token, challengeResult.walletAddress, profile);
        store.setPrivateKey(privateKey, profile);
        spinner.succeed(chalk.green('Authenticated successfully'));
        console.log(`  Wallet: ${chalk.cyan(challengeResult.walletAddress)}`);
        console.log(`  Profile: ${chalk.cyan(profile)}`);
      } catch (err) {
        spinner.fail(chalk.red('Authentication failed'));
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // auth status
  auth
    .command('status')
    .description('Show current authentication status')
    .option('--profile <profile>', 'Profile to check')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const cred = store.getToken(profile);

      console.log(`Profile: ${chalk.cyan(profile)}`);
      if (!cred) {
        console.log(`Status:  ${chalk.yellow('Not authenticated')}`);
        return;
      }
      console.log(`Status:  ${chalk.green('Authenticated')}`);
      console.log(`Wallet:  ${chalk.cyan(cred.walletAddress)}`);
      console.log(`Stored:  ${chalk.dim(cred.storedAt)}`);

      // Detect token type and cross-gateway compatibility
      const isMcpWalletToken = cred.token.startsWith('mcpwt_');
      if (isMcpWalletToken) {
        console.log(`Type:    ${chalk.green('mcpwt_')} ${chalk.dim('(wallet token — works with both agent and MCP gateways)')}`);
      } else {
        console.log(`Type:    ${chalk.yellow('JWT')} ${chalk.dim('(agent gateway only — 24h expiry)')}`);
      }

      if (cred.expiresAt) {
        const expiryDate = new Date(cred.expiresAt);
        const now = new Date();
        const expired = expiryDate < now;
        const msRemaining = expiryDate.getTime() - now.getTime();

        let timeRemaining = '';
        if (!expired) {
          const days = Math.floor(msRemaining / (1000 * 60 * 60 * 24));
          const hours = Math.floor((msRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
          if (days > 0) {
            timeRemaining = `${days}d ${hours}h remaining`;
          } else if (hours > 0) {
            timeRemaining = `${hours}h ${minutes}m remaining`;
          } else {
            timeRemaining = `${minutes}m remaining`;
          }
        }

        const label = expired ? chalk.red('Expired') : chalk.green('Valid');
        const remaining = expired ? chalk.red('(expired)') : chalk.dim(`(${timeRemaining})`);
        console.log(`Expires: ${label} ${remaining} — ${cred.expiresAt}`);
      }
      console.log(`Token:   ${chalk.dim(cred.token.slice(0, 20) + '...')}`);

      // Show x402 payment status
      const pk = store.getPrivateKey(profile);
      if (pk) {
        console.log(`x402:    ${chalk.green('✓ payments enabled')}`);
      } else {
        console.log(`x402:    ${chalk.yellow('✗ no private key')} (login with --private-key to enable)`);
      }

      // Non-blocking balance check
      try {
        const gatewayUrl = (config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
        const balanceRes = await fetch(`${gatewayUrl}/wallet/balance`, {
          headers: { Authorization: `Bearer ${cred.token}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (balanceRes.ok) {
          const balData = await balanceRes.json();
          const balance = parseFloat(String(balData.availableBalanceUsd ?? balData.balance ?? '0').replace(/^\$/, '')) || 0;
          if (balance === 0) {
            console.log();
            console.log(chalk.red.bold('⚠ Wallet balance is $0.00 — fund your wallet to use tools and agents'));
            console.log(chalk.dim('  Run `rickydata wallet balance` for deposit instructions'));
          } else if (balance < 1.0) {
            console.log(chalk.yellow(`  Balance: $${balance.toFixed(4)} USDC (low)`));
          } else {
            console.log(chalk.green(`  Balance: $${balance.toFixed(2)} USDC`));
          }
        }
      } catch {
        // Silently ignore — auth status should work offline
      }
    });

  // auth logout
  auth
    .command('logout')
    .description('Clear stored credentials')
    .option('--profile <profile>', 'Profile to clear')
    .action((opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      store.clear(profile);
      console.log(chalk.green(`Credentials cleared for profile: ${profile}`));
    });

  // auth token create
  const tokenCmd = new Command('token').description('Manage wallet tokens');

  tokenCmd
    .command('create')
    .description('Create a long-lived wallet token')
    .option('--private-key <key>', 'Private key (0x-prefixed or raw hex)')
    .option('--expires-at <date>', 'Expiry date (ISO 8601)', '2027-01-01T00:00:00Z')
    .option('--profile <profile>', 'Profile to store credentials in')
    .option('--gateway <url>', 'Override MCP gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getMcpGatewayUrl(profile)).replace(/\/$/, '');
      const expiresAt = opts.expiresAt;

      let privateKey = opts.privateKey;
      if (!privateKey) {
        privateKey = await promptSecret('Enter private key: ');
      }
      if (!privateKey) {
        fail('Private key is required.');
      }

      const spinner = ora('Creating wallet token...').start();
      try {
        const result = await createWalletTokenFlow(gatewayUrl, privateKey, expiresAt);
        store.setToken(result.token, result.walletAddress, profile, result.expiresAt);
        spinner.succeed(chalk.green('Wallet token created'));
        console.log(`  Wallet:  ${chalk.cyan(result.walletAddress)}`);
        console.log(`  Expires: ${chalk.cyan(result.expiresAt)}`);
        console.log(`  Token:   ${chalk.dim(result.token.slice(0, 30) + '...')}`);
        console.log(`  Profile: ${chalk.cyan(profile)}`);
      } catch (err) {
        spinner.fail(chalk.red('Token creation failed'));
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  auth.addCommand(tokenCmd);

  return auth;
}
