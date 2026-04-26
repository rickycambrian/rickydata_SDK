import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

// ── Claude Code Wrapper Installation ─────────────────────────────────

const WRAPPER_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
NATIVE_CLAUDE="$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")"
TOKEN=$(node -e "try{const c=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.rickydata/credentials.json','utf8'));const profiles=c.profiles||{};console.log((profiles.default||profiles[Object.keys(profiles)[0]]||{}).token||'')}catch{}")
MODEL_ARG=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--model" ]]; then
    MODEL_ARG="$arg"
    break
  fi
  case "$arg" in
    --model=*) MODEL_ARG="\${arg#--model=}"; break ;;
  esac
  prev="$arg"
done
MODEL_LOWER=$(printf '%s' "$MODEL_ARG" | tr '[:upper:]' '[:lower:]')
CUSTOM_MODEL_OPTION="rickydata-agent"
case "$MODEL_LOWER" in
  glm-*|glm*|deepseek-*|deepseek*|gemini-*|gemini*) CUSTOM_MODEL_OPTION="$MODEL_ARG" ;;
esac
exec env \\
  ANTHROPIC_BASE_URL='https://agents.rickydata.org/claude-compat' \\
  ANTHROPIC_AUTH_TOKEN="$TOKEN" \\
  ANTHROPIC_CUSTOM_MODEL_OPTION="$CUSTOM_MODEL_OPTION" \\
  ANTHROPIC_CUSTOM_MODEL_OPTION_NAME='rickydata TEE Agent' \\
  ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION='Route through rickydata TEE gateway' \\
  API_TIMEOUT_MS='3000000' \\
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1' \\
  "$NATIVE_CLAUDE" "$@"
`;

async function installClaudeCodeWrapper(): Promise<'installed' | 'skipped' | 'error'> {
  const binDir = path.join(os.homedir(), 'bin');
  const wrapperPath = path.join(binDir, 'rickydata-claude');

  try {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(wrapperPath, WRAPPER_SCRIPT, { encoding: 'utf8', mode: 0o755 });
    return 'installed';
  } catch (err) {
    console.log(chalk.dim(`  Could not write wrapper: ${err instanceof Error ? err.message : String(err)}`));
    return 'error';
  }
}

function isBinInPath(): boolean {
  const binDir = path.join(os.homedir(), 'bin');
  const pathDirs = (process.env.PATH ?? '').split(path.delimiter);
  return pathDirs.some(d => d === binDir || path.resolve(d) === binDir);
}

async function runClaudeCodeWrapperStep(autoYes: boolean): Promise<void> {
  const wrapperPath = path.join(os.homedir(), 'bin', 'rickydata-claude');
  const alreadyInstalled = fs.existsSync(wrapperPath);

  if (alreadyInstalled && !autoYes) {
    console.log(chalk.dim('rickydata-claude wrapper already installed at ~/bin/rickydata-claude.'));
    const shouldReinstall = await promptYesNo('  Reinstall?', false);
    if (!shouldReinstall) {
      console.log(chalk.dim('  Skipped — keeping existing wrapper'));
      return;
    }
  } else if (!autoYes) {
    const shouldInstall = await promptYesNo(
      'Set up Claude Code to use rickydata gateway? (routes LLM calls through TEE)',
      false,
    );
    if (!shouldInstall) {
      console.log(chalk.dim('  Skipped — run `rickydata init --claude-code` anytime to install'));
      return;
    }
  }

  const spinner = ora('Installing rickydata-claude wrapper...').start();
  const result = await installClaudeCodeWrapper();

  if (result === 'installed') {
    spinner.succeed(`Wrapper installed at ${chalk.cyan('~/bin/rickydata-claude')}`);
    console.log(chalk.dim('  Reads your token dynamically — no re-install needed after re-auth'));

    if (!isBinInPath()) {
      console.log();
      console.log(chalk.yellow('  ~/bin is not in your PATH. Add this to ~/.zshrc or ~/.bashrc:'));
      console.log(chalk.cyan('    export PATH="$HOME/bin:$PATH"'));
      console.log(chalk.dim('  Then open a new terminal and run: rickydata-claude'));
    } else {
      console.log(chalk.dim('  Usage: rickydata-claude (in place of claude)'));
    }
  } else {
    spinner.fail('Failed to install wrapper');
    console.log(chalk.dim(`  Path: ${wrapperPath}`));
    console.log(chalk.dim('  You can install manually — see `rickydata init --claude-code`'));
  }
}

// ── Init Command ─────────────────────────────────────────────────────

export function createInitCommand(config: ConfigManager, store: CredentialStore): Command {
  return new Command('init')
    .description('Set up rickydata: authenticate, connect to Claude Code, and verify')
    .option('--profile <profile>', 'Config profile')
    .option('-y, --yes', 'Auto-accept all prompts')
    .option('--skip-verify', 'Skip connection verification')
    .option('--claude-code', 'Install the rickydata-claude wrapper only (skip other steps)')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const mcpUrl = config.getMcpGatewayUrl(profile).replace(/\/$/, '');
      const autoYes = opts.yes ?? false;

      // ─── Standalone --claude-code flag ───────────────────────────
      if (opts.claudeCode) {
        console.log();
        console.log(chalk.bold('rickydata Claude Code wrapper'));
        console.log(chalk.dim('─────────────────────────────'));
        await runClaudeCodeWrapperStep(autoYes);
        console.log();
        return;
      }

      console.log();
      console.log(chalk.bold('Welcome to rickydata!') + ' Let\'s get you set up.');
      console.log();

      // ─── Step 1: Authentication ──────────────────────────────────
      console.log(chalk.bold('Step 1/5: Authentication'));
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

      // ─── Step 1b: Terms of Service ──────────────────────────────
      const agentUrl = config.getAgentGatewayUrl(profile).replace(/\/$/, '');
      if (token) {
        try {
          const tosRes = await fetch(`${agentUrl}/wallet/tos-status`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000),
          });
          if (tosRes.ok) {
            const tosData = await tosRes.json() as { accepted?: boolean; version?: string };
            if (!tosData.accepted) {
              console.log(chalk.bold('Terms of Service'));
              console.log(chalk.dim('────────────────'));
              console.log('By using rickydata you agree to the Terms of Service:');
              console.log(chalk.dim('  - Your API keys are encrypted and scoped to your wallet'));
              console.log(chalk.dim('  - Tool calls may incur x402 micropayments (USDC on Base)'));
              console.log(chalk.dim('  - Free tier: 100 daily requests at no cost'));
              console.log(chalk.dim('  https://marketplace.rickydata.org/#/terms'));
              console.log();

              const accepted = autoYes || await promptYesNo('Accept Terms of Service?', true);
              if (accepted) {
                try {
                  const acceptRes = await fetch(`${agentUrl}/wallet/accept-tos`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(5000),
                  });
                  if (acceptRes.ok) {
                    console.log(chalk.green('✓') + ' Terms of Service accepted');
                  } else {
                    console.log(chalk.yellow('Could not record ToS acceptance — continuing'));
                  }
                } catch {
                  console.log(chalk.yellow('Could not record ToS acceptance — continuing'));
                }
              } else {
                console.log(chalk.yellow('ToS not accepted — you can accept later at first chat'));
              }
              console.log();
            }
          }
          // If endpoint returns non-ok (404 etc.), silently skip — endpoint may not exist yet
        } catch {
          // Network error or timeout — silently skip ToS check
        }
      }

      // ─── Step 2: rickydata MCP Server ─────────────────────────
      console.log(chalk.bold('Step 2/5: rickydata MCP Server'));
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

      // ─── Step 3: Agent Proxy ──────────────────────────────────────
      console.log(chalk.bold('Step 3/5: Agent Proxy'));
      console.log(chalk.dim('─────────────────────'));

      if (claudeInstalled) {
        const { execFileSync } = await import('child_process');

        // Check if proxy already configured
        let proxyConfigured = false;
        try {
          const listOut = execFileSync('claude', ['mcp', 'list'], { stdio: 'pipe', encoding: 'utf-8' });
          proxyConfigured = listOut.includes('rickydata-proxy');
        } catch {
          // mcp list failed
        }

        let shouldConfigureProxy = true;
        if (proxyConfigured && !autoYes) {
          console.log(chalk.dim('Agent proxy is already configured in Claude Code.'));
          shouldConfigureProxy = await promptYesNo('  Reconfigure?', false);
        }

        if (shouldConfigureProxy) {
          const spinner = ora('Setting up agent proxy...').start();
          try {
            try { execFileSync('claude', ['mcp', 'remove', 'rickydata-proxy'], { stdio: 'pipe' }); } catch { /* not present */ }

            execFileSync('claude', [
              'mcp', 'add', '--transport', 'stdio',
              'rickydata-proxy', '--',
              'rickydata', 'mcp', 'proxy-server',
            ], { stdio: 'pipe' });
            spinner.succeed('Agent proxy added to Claude Code');
            console.log(chalk.dim('  Enable agents with: rickydata mcp agent enable <agent-id>'));
          } catch {
            spinner.fail('Could not configure agent proxy automatically');
            console.log(chalk.dim('  Run `rickydata mcp proxy-connect` to set it up manually'));
          }
        } else {
          console.log(chalk.dim('  Skipped — keeping existing configuration'));
        }
      } else {
        console.log(chalk.dim('Claude Code not installed — skipping agent proxy setup.'));
        console.log(chalk.dim('After installing Claude Code, run: rickydata mcp proxy-connect'));
      }

      console.log();

      // ─── Step 4: Verification ────────────────────────────────────
      console.log(chalk.bold('Step 4/5: Verification'));
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

      // ─── Step 5: Default Provider ─────────────────────────────────
      console.log(chalk.bold('Step 5/7: Default Provider'));
      console.log(chalk.dim('──────────────────────────'));
      console.log('Choose your default AI model for agent chat:');
      console.log();
      console.log(chalk.cyan('  1.') + chalk.bold(' OpenRouter — Gemma 4') + chalk.dim(' (50 free/day, zero data retention)') + chalk.green(' [recommended]'));
      console.log(chalk.cyan('  2.') + chalk.bold(' MiniMax — M2.7') + chalk.dim(' (100 free/day)'));
      console.log(chalk.cyan('  3.') + chalk.bold(' Anthropic — Claude') + chalk.dim(' (bring your own key)'));
      console.log(chalk.cyan('  4.') + chalk.bold(' DeepSeek — V4 Pro') + chalk.dim(' (via rickydata provider)'));
      console.log(chalk.cyan('  5.') + chalk.bold(' Gemini — 2.5 Pro') + chalk.dim(' (bring your own key)'));
      console.log();

      let providerChoice = '1';  // Default: OpenRouter
      if (!autoYes) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        providerChoice = await new Promise<string>((resolve) => {
          rl.question('Your choice [1]: ', (answer) => {
            rl.close();
            resolve(answer.trim() || '1');
          });
        });
      }

      const providerMap: Record<string, { plan: string; modelProvider: string; defaultModel: string; label: string }> = {
        '1': { plan: 'free', modelProvider: 'openrouter', defaultModel: 'google/gemma-4-26b-a4b-it', label: 'OpenRouter (Gemma 4)' },
        '2': { plan: 'free', modelProvider: 'minimax', defaultModel: 'MiniMax-M2.7-highspeed', label: 'MiniMax (M2.7)' },
        '3': { plan: 'byok', modelProvider: 'anthropic', defaultModel: 'claude-haiku-4-5-20251001', label: 'Anthropic (Claude)' },
        '4': { plan: 'free', modelProvider: 'deepseek', defaultModel: 'deepseek-v4-pro', label: 'DeepSeek (V4 Pro)' },
        '5': { plan: 'gemini_byok', modelProvider: 'gemini', defaultModel: 'gemini-2.5-pro', label: 'Gemini (2.5 Pro)' },
      };
      const chosen = providerMap[providerChoice] ?? providerMap['1'];

      if (token) {
        const settingsSpinner = ora(`Setting default provider to ${chosen.label}...`).start();
        try {
          const settingsRes = await fetch(`${agentUrl}/wallet/settings`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              plan: chosen.plan,
              modelProvider: chosen.modelProvider,
              defaultModel: chosen.defaultModel,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (settingsRes.ok) {
            settingsSpinner.succeed(`Default provider: ${chalk.cyan(chosen.label)}`);
            if (chosen.modelProvider === 'openrouter') {
              console.log(chalk.dim('  Zero data retention — your prompts are not stored by the provider'));
            }
            if (chosen.modelProvider === 'anthropic') {
              console.log(chalk.dim('  Run `rickydata apikey set` to add your Anthropic API key'));
            }
            if (chosen.modelProvider === 'deepseek') {
              console.log(chalk.dim('  DeepSeek requests route through the rickydata gateway provider'));
            }
            if (chosen.modelProvider === 'gemini') {
              console.log(chalk.dim('  Add your Gemini API key at https://rickydata.org/settings before chatting'));
            }
          } else {
            settingsSpinner.fail('Could not update provider settings');
            console.log(chalk.dim('  You can change this later at https://marketplace.rickydata.org/#/wallet'));
          }
        } catch {
          settingsSpinner.fail('Could not reach gateway to update settings');
          console.log(chalk.dim('  You can change this later at https://marketplace.rickydata.org/#/wallet'));
        }
      }

      console.log();

      // ─── Step 6: Claude Code Wrapper ────────────────────────────
      console.log(chalk.bold('Step 6/7: Claude Code Wrapper'));
      console.log(chalk.dim('─────────────────────────────'));
      await runClaudeCodeWrapperStep(autoYes);
      console.log();

      // ─── Step 7: Ready ───────────────────────────────────────────
      console.log(chalk.bold('Step 7/7: Ready!'));
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
      console.log(chalk.dim('  rickydata auth status          Check your auth and balance'));
      console.log(chalk.dim('  rickydata mcp search           Find MCP servers'));
      console.log(chalk.dim('  rickydata mcp tools            List your enabled tools'));
      console.log(chalk.dim('  rickydata mcp agent enable     Enable an agent as MCP tools'));
      console.log(chalk.dim('  rickydata mcp agent disable    Remove agent tools'));
      console.log(chalk.dim('  rickydata mcp agent list       Show enabled agents'));
      console.log();
      const freeTierMsg = chosen.modelProvider === 'openrouter'
        ? '50 free daily requests with Gemma 4 (zero data retention)'
        : chosen.modelProvider === 'minimax'
          ? '100 free daily requests with MiniMax M2.7'
          : chosen.modelProvider === 'deepseek'
            ? 'DeepSeek V4 Pro through the rickydata gateway provider'
            : 'Unlimited with your Anthropic API key (10% platform fee)';
      console.log(chalk.green('✓') + ` ${freeTierMsg}`);
      console.log(chalk.green('✓') + ' Agent chat works immediately — no funding needed to start');
      console.log();
      console.log(chalk.dim('Optional next steps:'));
      console.log(chalk.dim('  rickydata chat <agent-id>      Start chatting (works on free tier!)'));
      console.log(chalk.dim('  rickydata apikey set           Upgrade to Anthropic/OpenRouter (BYOK)'));
      console.log(chalk.dim('  rickydata wallet balance       Check your USDC balance'));
      console.log();
    });
}

// ── Browser Login (extracted for reuse) ──────────────────────────────

async function runBrowserLogin(store: CredentialStore, profile: string): Promise<string> {
  const marketplaceUrl = 'https://marketplace.rickydata.org/#/auth/cli';

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
