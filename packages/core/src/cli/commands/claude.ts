import { Command } from 'commander';
import chalk from 'chalk';
import * as crypto from 'crypto';
import * as http from 'http';
import * as readline from 'readline';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'net';
import { AgentClient } from '../../agent/agent-client.js';
import type { AnthropicOAuthBundle } from '../../agent/types.js';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { CliError, fail } from '../errors.js';

// ─── Verified OAuth constants (from claude-code v2.1.x `claude /login`) ───────
// CLIENT_ID, scopes, authorize/token/redirect URLs all mirror the live flow so
// Anthropic's IdP honors the request. Confirm against `claude /login` if these drift.
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL_CLAUDE = 'https://claude.ai/oauth/authorize';
const AUTHORIZE_URL_CONSOLE = 'https://console.anthropic.com/oauth/authorize';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const MANUAL_REDIRECT_URL = 'https://console.anthropic.com/oauth/code/callback';
const SCOPES = ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code'];

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

function makeClient(config: ConfigManager, store: CredentialStore, opts: { profile?: string; gateway?: string }): AgentClient {
  const profile = opts.profile ?? config.getActiveProfile();
  const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
  const token = requireAuth(store, profile);
  const privateKey = store.getPrivateKey(profile) ?? undefined;
  return new AgentClient({ token, privateKey, gatewayUrl });
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(opts: {
  base: string;
  redirectUri: string;
  challenge: string;
  state: string;
}): string {
  const url = new URL(opts.base);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('code_challenge', opts.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', opts.state);
  return url.toString();
}

async function tryOpenBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    // Best-effort only; the URL is always printed for manual navigation.
  }
}

interface CapturedCode {
  code: string;
  state: string;
}

/**
 * Capture the authorization code via a loopback HTTP listener on an ephemeral
 * port (RFC 8252). Anthropic's IdP honors dynamic `http://localhost:<port>/callback`
 * redirects, matching how `claude /login` itself works.
 */
async function captureViaLoopback(opts: {
  base: string;
  challenge: string;
  state: string;
}): Promise<{ captured: CapturedCode; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      server.close();
      fn();
    };

    server.on('error', (err) => finish(() => reject(err)));

    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address() as AddressInfo;
      const redirectUri = `http://localhost:${port}/callback`;
      const authorizeUrl = buildAuthorizeUrl({ base: opts.base, redirectUri, challenge: opts.challenge, state: opts.state });

      server.on('request', (req, res) => {
        const reqUrl = new URL(req.url ?? '/', redirectUri);
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404).end();
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const returnedState = reqUrl.searchParams.get('state');
        const errParam = reqUrl.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (errParam) {
          res.end('<html><body><h2>Authorization failed.</h2><p>You can close this tab and return to the terminal.</p></body></html>');
          finish(() => reject(new Error(`Authorization denied: ${errParam}`)));
          return;
        }
        if (!code || !returnedState) {
          res.end('<html><body><h2>Missing authorization code.</h2><p>You can close this tab and return to the terminal.</p></body></html>');
          finish(() => reject(new Error('Loopback callback missing code or state.')));
          return;
        }
        res.end('<html><body><h2>Authorization complete.</h2><p>You can close this tab and return to the terminal.</p></body></html>');
        finish(() => resolve({ captured: { code, state: returnedState }, redirectUri }));
      });

      console.log('\nOpen this URL to authorize RickyData with your Claude account:\n');
      console.log(chalk.cyan(authorizeUrl));
      console.log(chalk.dim('\nWaiting for authorization (listening on the loopback callback)…'));
      await tryOpenBrowser(authorizeUrl);
    });
  });
}

/**
 * Manual paste fallback: the IdP redirects to the registered console callback,
 * which displays a `code#state` string for the user to paste back.
 */
async function captureViaPaste(opts: {
  base: string;
  challenge: string;
  state: string;
}): Promise<{ captured: CapturedCode; redirectUri: string }> {
  const redirectUri = MANUAL_REDIRECT_URL;
  const authorizeUrl = buildAuthorizeUrl({ base: opts.base, redirectUri, challenge: opts.challenge, state: opts.state });

  console.log('\nOpen this URL to authorize RickyData with your Claude account:\n');
  console.log(chalk.cyan(authorizeUrl));
  console.log(chalk.dim('\nAfter approving, copy the code shown on the page (format: code#state).'));
  await tryOpenBrowser(authorizeUrl);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('A TTY is required to paste the authorization code. Re-run interactively.');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const pasted = await new Promise<string>((resolve) => {
    rl.question('\nPaste the authorization code: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const [code, returnedState] = pasted.split('#');
  if (!code || !returnedState) {
    fail('Invalid code. Expected the full `code#state` string shown after authorization.');
  }
  return { captured: { code, state: returnedState }, redirectUri };
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  account?: { subscription_type?: string };
}

async function exchangeCode(opts: {
  code: string;
  state: string;
  verifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: opts.verifier,
      state: opts.state,
    }),
  });
  if (!res.ok) {
    // Never echo the response body verbatim — it may contain token material on
    // some IdP error paths. Surface only the status.
    if (res.status === 401 || res.status === 400) {
      throw new Error('Token exchange failed: the authorization code was invalid or expired. Re-run `rickydata claude sync`.');
    }
    throw new Error(`Token exchange failed: HTTP ${res.status}.`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Token exchange returned an unexpected response (no tokens).');
  }
  return data;
}

export function buildBundle(tokens: TokenResponse, nowMs: number): AnthropicOAuthBundle {
  const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);
  return {
    claudeAiOauth: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: nowMs + (tokens.expires_in ?? 3600) * 1000,
      scopes: scopes.length ? scopes : SCOPES,
      ...(tokens.account?.subscription_type ? { subscriptionType: tokens.account.subscription_type } : {}),
    },
  };
}

export function normalizeLocalClaudeOAuthBundle(value: unknown): AnthropicOAuthBundle {
  if (!value || typeof value !== 'object') throw new Error('Local Claude credential is not a JSON object.');
  const root = value as Record<string, unknown>;
  const raw = root.claudeAiOauth && typeof root.claudeAiOauth === 'object'
    ? root.claudeAiOauth as Record<string, unknown>
    : root;
  if (typeof raw.accessToken !== 'string' || typeof raw.refreshToken !== 'string') {
    throw new Error('Local Claude credential is missing its OAuth access or refresh token.');
  }
  const expiresAt = Number(raw.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    throw new Error('Local Claude credential has an invalid expiry.');
  }
  const scopes = Array.isArray(raw.scopes)
    ? raw.scopes.filter((scope): scope is string => typeof scope === 'string' && scope.length > 0)
    : [];
  return {
    claudeAiOauth: {
      accessToken: raw.accessToken,
      refreshToken: raw.refreshToken,
      expiresAt,
      scopes: scopes.length ? scopes : SCOPES,
      ...(typeof raw.subscriptionType === 'string' && raw.subscriptionType
        ? { subscriptionType: raw.subscriptionType }
        : {}),
    },
  };
}

export function readLocalClaudeOAuthBundle(authPath?: string): AnthropicOAuthBundle {
  let raw: string;
  if (authPath) {
    raw = readFileSync(authPath, 'utf8');
  } else if (process.platform === 'darwin') {
    raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } else {
    raw = readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8');
  }
  try {
    return normalizeLocalClaudeOAuthBundle(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Local Claude credential is not valid JSON.');
    throw error;
  }
}

export function createClaudeCommands(config: ConfigManager, store: CredentialStore): Command {
  const claude = new Command('claude').description('Manage Claude (Anthropic) OAuth subscription auth for RickyData execution');

  claude
    .command('status')
    .description('Check synced Claude OAuth subscription auth status')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        const remote = await client.getAnthropicOAuthStatus();
        console.log(`Remote: ${remote.configured ? chalk.green('Configured') : chalk.yellow('Not configured')}`);
        if (remote.configured) {
          console.log(chalk.dim(`Tokens present: ${(remote.hasRefreshToken ?? remote.hasTokens) ? 'yes' : 'no'}`));
          if (remote.scopes?.length) console.log(chalk.dim(`Scopes: ${remote.scopes.join(' ')}`));
          if (remote.subscriptionType) console.log(chalk.dim(`Subscription: ${remote.subscriptionType}`));
          if (remote.expiresAt) console.log(chalk.dim(`Access token expires: ${new Date(remote.expiresAt).toISOString()}`));
          if (remote.encryptionMode) console.log(chalk.dim(`Encryption: ${remote.encryptionMode}`));
          if (remote.unlocked !== undefined) console.log(chalk.dim(`Unlocked: ${remote.unlocked ? 'yes' : 'no'}`));
          if (remote.needsMigration) console.log(chalk.yellow('Remote credential needs migration. Run `rickydata claude sync`.'));
          if (remote.updatedAt) console.log(chalk.dim(`Updated: ${remote.updatedAt}`));
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  claude
    .command('sync')
    .description('Run the Claude OAuth login and upload the credential for subscription-backed Claude execution')
    .option('--paste', 'Use the paste-the-code flow instead of the loopback listener')
    .option('--console', 'Authorize via console.anthropic.com (Console/API account) instead of claude.ai')
    .option('--from-local', 'Upload the OAuth credential from the local Claude Code login')
    .option('--auth-path <path>', 'Read a local Claude credential JSON file instead of the platform credential store')
    .option('--yes', 'Confirm noninteractive local credential sync')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        // Construct the client first so auth/signing problems surface before login.
        const client = makeClient(config, store, opts);
        let bundle: AnthropicOAuthBundle;
        if (opts.fromLocal) {
          if (!opts.yes) fail('Pass --yes to confirm noninteractive upload of the local Claude Code credential.');
          bundle = readLocalClaudeOAuthBundle(opts.authPath);
        } else {
          if (opts.authPath) fail('--auth-path requires --from-local.');
          const base = opts.console ? AUTHORIZE_URL_CONSOLE : AUTHORIZE_URL_CLAUDE;
          const { verifier, challenge } = generatePkce();
          const state = base64url(crypto.randomBytes(32));

          let result: { captured: CapturedCode; redirectUri: string };
          if (opts.paste) {
            result = await captureViaPaste({ base, challenge, state });
          } else {
            try {
              result = await captureViaLoopback({ base, challenge, state });
            } catch (loopbackErr) {
              console.log(chalk.yellow(`\nLoopback capture unavailable (${loopbackErr instanceof Error ? loopbackErr.message : 'error'}). Falling back to paste flow.`));
              result = await captureViaPaste({ base, challenge, state });
            }
          }

          if (result.captured.state !== state) {
            fail('State mismatch — the authorization response did not match this request. Aborting for safety.');
          }

          const tokens = await exchangeCode({
            code: result.captured.code,
            state,
            verifier,
            redirectUri: result.redirectUri,
          });
          bundle = buildBundle(tokens, Date.now());
        }

        const status = await client.setAnthropicOAuth(bundle);
        console.log(chalk.green('\nClaude OAuth credential encrypted and synced.'));
        console.log(chalk.dim(`Remote status: ${status.configured ? 'configured' : 'not configured'}`));
        if (status.scopes?.length) console.log(chalk.dim(`Scopes: ${status.scopes.join(' ')}`));
        if (status.encryptionMode) console.log(chalk.dim(`Encryption: ${status.encryptionMode}`));
        if (status.unlocked !== undefined) console.log(chalk.dim(`Unlocked: ${status.unlocked ? 'yes' : 'no'}`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  claude
    .command('unlock')
    .description('Unlock encrypted Claude OAuth credential for the current gateway session')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        const status = await client.unlockAnthropicOAuth();
        console.log(chalk.green('Claude OAuth credential unlocked.'));
        if (status.encryptionMode) console.log(chalk.dim(`Encryption: ${status.encryptionMode}`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  claude
    .command('delete')
    .description('Delete synced Claude OAuth credential from the gateway')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      try {
        const client = makeClient(config, store, opts);
        await client.deleteAnthropicOAuth();
        console.log(chalk.green('Claude OAuth credential deleted.'));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return claude;
}
