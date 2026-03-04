import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { CLI_VERSION } from '../version.js';

const MCP_PROTOCOL_VERSION = '2025-03-26';

// ── Helpers ──────────────────────────────────────────────────────────

function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const input: string[] = [];

    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', (answer) => { rl.close(); resolve(answer); });
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input.join(''));
          return;
        } else if (code === 3) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.exit(0);
        } else if (code === 127 || code === 8) {
          if (input.length > 0) { input.pop(); process.stdout.write('\b \b'); }
        } else if (code >= 32) {
          input.push(ch);
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${hint} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function decodeToken(token: string): { wallet: string; expiresAt?: string; type: string } {
  if (token.startsWith('mcpwt_')) {
    try {
      const payload = JSON.parse(Buffer.from(token.slice(6), 'base64url').toString());
      return {
        wallet: payload.wallet ?? '(unknown)',
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
        type: 'mcpwt_',
      };
    } catch { /* fallthrough */ }
  }
  if (token.startsWith('eyJ')) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return {
        wallet: payload.walletAddress ?? '(unknown)',
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
        type: 'JWT',
      };
    } catch { /* fallthrough */ }
  }
  return { wallet: '(unknown)', type: 'unknown' };
}

function formatTimeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(ms / (1000 * 60))}m`;
}

// ── Init Command ─────────────────────────────────────────────────────

export function createInitCommand(config: ConfigManager, store: CredentialStore): Command {
  return new Command('init')
    .description('Set up rickydata: authenticate, connect to Claude Code, and verify')
    .option('--profile <profile>', 'Config profile')
    .option('-y, --yes', 'Auto-accept all prompts')
    .option('--skip-verify', 'Skip connection verification')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '');
      const autoYes = opts.yes ?? false;

      console.log();
      console.log(chalk.bold('Welcome to rickydata!') + ' Let\'s get you set up.');
      console.log();

      // ─── Step 1: Authentication ──────────────────────────────────
      console.log(chalk.bold('Step 1/4: Authentication'));
      console.log(chalk.dim('────────────────────────'));

      const existingCred = store.getToken(profile);
      let token: string;

      if (existingCred?.token) {
        const decoded = decodeToken(existingCred.token);
        const isExpired = decoded.expiresAt && new Date(decoded.expiresAt) < new Date();

        if (isExpired) {
          console.log(chalk.yellow('Your token has expired. Let\'s re-authenticate.'));
          console.log();
          token = await runBrowserLogin(store, profile);
        } else {
          const remaining = decoded.expiresAt ? formatTimeRemaining(decoded.expiresAt) : '';
          console.log(chalk.green('✓') + ` Already logged in as ${chalk.cyan(decoded.wallet.slice(0, 8) + '...' + decoded.wallet.slice(-4))}`);
          if (remaining) console.log(chalk.dim(`  Token expires in ${remaining}`));

          const shouldContinue = autoYes || await promptYesNo('  Continue with this account?', true);
          if (!shouldContinue) {
            token = await runBrowserLogin(store, profile);
          } else {
            token = existingCred.token;
          }
        }
      } else {
        token = await runBrowserLogin(store, profile);
      }

      console.log();

      // ─── Step 2: rickydata MCP Server ─────────────────────────
      console.log(chalk.bold('Step 2/4: rickydata MCP Server'));
      console.log(chalk.dim('──────────────────────────────'));

      const rickyServerUrl = 'https://rickydata-mcp-server-2dbp4scmrq-uc.a.run.app';

      let claudeInstalled = false;
      try {
        const { execFileSync } = await import('child_process');
        execFileSync('which', ['claude'], { stdio: 'pipe' });
        claudeInstalled = true;
      } catch {
        // claude not found
      }

      if (!claudeInstalled) {
        console.log(chalk.yellow('Claude Code CLI not found.'));
        console.log(chalk.dim('Install it from https://claude.com/claude-code'));
        console.log();
        console.log('After installing, run this to connect manually:');
        console.log();
        const cmdStr = token
          ? `  claude mcp add --transport http rickydata ${rickyServerUrl}/mcp \\\n    --header "Authorization:Bearer ${token.slice(0, 20)}..."`
          : `  claude mcp add --transport http rickydata ${rickyServerUrl}/mcp`;
        console.log(chalk.cyan(cmdStr));
        console.log();
      } else {
        const { execFileSync } = await import('child_process');

        // Check if already configured
        let alreadyConfigured = false;
        try {
          const listOut = execFileSync('claude', ['mcp', 'list'], { stdio: 'pipe', encoding: 'utf-8' });
          alreadyConfigured = listOut.includes('rickydata');
        } catch {
          // mcp list failed — probably not configured
        }

        let shouldConfigure = true;
        if (alreadyConfigured && !autoYes) {
          console.log(chalk.dim('rickydata MCP server is already configured in Claude Code.'));
          shouldConfigure = await promptYesNo('  Reconfigure with current token?', true);
        }

        if (shouldConfigure) {
          const spinner = ora('Connecting to Claude Code...').start();
          try {
            // Remove old mcp-gateway if present
            try { execFileSync('claude', ['mcp', 'remove', 'mcp-gateway'], { stdio: 'pipe' }); } catch { /* not present */ }
            // Remove existing rickydata if present
            try { execFileSync('claude', ['mcp', 'remove', 'rickydata'], { stdio: 'pipe' }); } catch { /* not present */ }

            const args = ['mcp', 'add', '--transport', 'http', 'rickydata', `${rickyServerUrl}/mcp`];
            if (token) args.push('--header', `Authorization:Bearer ${token}`);

            execFileSync('claude', args, { stdio: 'pipe' });
            spinner.succeed('rickydata MCP server added to Claude Code');
          } catch (err) {
            spinner.fail('Failed to configure Claude Code');
            console.log(chalk.dim(`  Error: ${err instanceof Error ? err.message : String(err)}`));
            console.log(chalk.dim('  Run `rickydata mcp connect-server` to retry'));
          }
        } else {
          console.log(chalk.dim('  Skipped — keeping existing configuration'));
        }
      }

      console.log();

      // ─── Step 3: Verification ────────────────────────────────────
      console.log(chalk.bold('Step 3/4: Verification'));
      console.log(chalk.dim('──────────────────────'));

      if (opts.skipVerify) {
        console.log(chalk.dim('Skipped (--skip-verify)'));
      } else {
        const spinner = ora('Testing connection...').start();
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          };
          if (token) headers.Authorization = `Bearer ${token}`;

          const start = Date.now();

          // MCP initialize
          const initRes = await fetch(`${mcpUrl}/mcp`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              jsonrpc: '2.0', id: 1, method: 'initialize',
              params: {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'rickydata-cli', version: CLI_VERSION },
              },
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!initRes.ok) {
            const body = await initRes.text();
            if (initRes.status === 401 || initRes.status === 403) {
              spinner.fail('Authentication failed');
              console.log(chalk.dim('  Run `rickydata auth login` to re-authenticate'));
            } else {
              spinner.fail(`Gateway returned ${initRes.status}`);
              console.log(chalk.dim(`  ${body.slice(0, 200)}`));
            }
          } else {
            const latency = Date.now() - start;

            // tools/list
            const toolsRes = await fetch(`${mcpUrl}/mcp`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
              }),
              signal: AbortSignal.timeout(15000),
            });

            let toolCount = 0;
            if (toolsRes.ok) {
              const contentType = toolsRes.headers.get('content-type') ?? '';
              if (contentType.includes('text/event-stream')) {
                const text = await toolsRes.text();
                for (const line of text.split('\n')) {
                  if (line.startsWith('data: ')) {
                    try {
                      const json = JSON.parse(line.slice(6));
                      if (json.result?.tools) toolCount = json.result.tools.length;
                    } catch { /* skip */ }
                  }
                }
              } else {
                const json = await toolsRes.json();
                if (json.result?.tools) toolCount = json.result.tools.length;
              }
            }

            spinner.succeed(`Gateway reachable (${latency}ms)`);
            console.log(chalk.green('  ✓') + ' Authentication valid');
            console.log(chalk.green('  ✓') + ` ${toolCount} tools available` + (toolCount <= 10
              ? chalk.dim(' (meta-tools — enable servers to add more)')
              : ''));
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'TimeoutError') {
            spinner.fail('Gateway unreachable (timeout)');
            console.log(chalk.dim('  Check your network connection'));
            console.log(chalk.dim(`  Gateway URL: ${mcpUrl}`));
          } else {
            spinner.fail('Verification failed');
            console.log(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
          }
        }
      }

      console.log();

      // ─── Step 4: Ready ───────────────────────────────────────────
      console.log(chalk.bold('Step 4/4: Ready!'));
      console.log(chalk.dim('────────────────'));

      if (claudeInstalled) {
        console.log('Restart Claude Code, then try asking:');
        console.log();
        console.log(chalk.cyan('  "Search for a Brave search server and enable it"'));
        console.log(chalk.cyan('  "Find a tool that can search arXiv papers"'));
      } else {
        console.log('After installing Claude Code and running `rickydata mcp connect`:');
        console.log();
        console.log(chalk.cyan('  "Search for a Brave search server and enable it"'));
      }

      console.log();
      console.log(chalk.dim('Useful commands:'));
      console.log(chalk.dim('  rickydata auth status     Check your auth and balance'));
      console.log(chalk.dim('  rickydata mcp search      Find MCP servers'));
      console.log(chalk.dim('  rickydata mcp tools       List your enabled tools'));
      console.log();
      console.log(chalk.dim('Optional next steps:'));
      console.log(chalk.dim('  rickydata apikey set      Enable agent chat (requires Anthropic API key)'));
      console.log(chalk.dim('  rickydata wallet balance  Check your USDC balance'));
      console.log();
    });
}

// ── Browser Login (extracted for reuse) ──────────────────────────────

async function runBrowserLogin(store: CredentialStore, profile: string): Promise<string> {
  const marketplaceUrl = 'https://mcpmarketplace.rickydata.org/#/auth/cli';

  console.log(chalk.cyan('Opening browser for sign-in...'));
  console.log(chalk.dim('(email, Google, GitHub, Discord, or wallet)'));
  console.log();

  try {
    const { default: open } = await import('open');
    await open(marketplaceUrl);
  } catch {
    console.log(chalk.yellow('Open this URL in your browser:'));
    console.log(chalk.cyan(marketplaceUrl));
    console.log();
  }

  console.log(chalk.dim('After signing in, copy the token shown on the page.'));
  const pastedToken = await promptSecret('Paste your token here: ');

  if (!pastedToken) {
    console.error(chalk.red('No token provided.'));
    process.exit(1);
  }

  if (!pastedToken.startsWith('eyJ') && !pastedToken.startsWith('mcpwt_')) {
    console.error(chalk.red('Invalid token format. Expected JWT (eyJ...) or wallet token (mcpwt_...).'));
    process.exit(1);
  }

  const decoded = decodeToken(pastedToken);
  store.setToken(pastedToken, decoded.wallet, profile, decoded.expiresAt);

  const remaining = decoded.expiresAt ? formatTimeRemaining(decoded.expiresAt) : '';
  console.log(chalk.green('✓') + ` Logged in as ${chalk.cyan(decoded.wallet.slice(0, 8) + '...' + decoded.wallet.slice(-4))}` +
    (decoded.type === 'mcpwt_' ? chalk.dim(` (wallet token, ${remaining})`) : chalk.dim(` (${decoded.type})`)));

  return pastedToken;
}
