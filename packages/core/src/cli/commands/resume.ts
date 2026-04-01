import chalk from 'chalk';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { fail } from '../errors.js';

interface SessionInfo {
  id: string;
  agentId?: string;
  messageCount?: number;
  lastActive?: string;
  lastActiveAt?: number | string;
  model?: string;
  createdAt?: number | string;
  preview?: string;
}

interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function fetchSessions(gatewayUrl: string, token: string): Promise<SessionInfo[]> {
  const res = await fetch(`${gatewayUrl}/wallet/sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to list sessions: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.sessions ?? data.items ?? [];
}

async function fetchSessionMessages(
  gatewayUrl: string,
  token: string,
  agentId: string,
  sessionId: string,
): Promise<SessionMessage[]> {
  try {
    const res = await fetch(`${gatewayUrl}/agents/${agentId}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const messages: SessionMessage[] = data.messages ?? data.history ?? [];
    return messages;
  } catch {
    return [];
  }
}

function buildConversationSummary(messages: SessionMessage[], agentId: string, sessionId: string): string {
  if (messages.length === 0) {
    return `[Resuming session ${sessionId.slice(0, 8)} with agent: ${agentId}]\nNo prior messages available.`;
  }

  const recent = messages.slice(-10);
  const snippets = recent.map((m) => {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const truncated = text.length > 200 ? text.slice(0, 197) + '...' : text;
    return `${m.role}: ${truncated}`;
  });

  return [
    `[Resuming session ${sessionId.slice(0, 8)} with agent: ${agentId}]`,
    `Total messages: ${messages.length}`,
    '',
    'Recent conversation:',
    ...snippets,
  ].join('\n');
}

function findClaudeBinary(): string | null {
  // 1. Try `which claude`
  try {
    const result = execFileSync('which', ['claude'], { encoding: 'utf8', timeout: 5000 }).trim();
    if (result && existsSync(result)) return result;
  } catch { /* not found via which */ }

  // 2. Common install locations
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return null;
}

export async function handleResume(
  prefix: string,
  config?: ConfigManager,
  store?: CredentialStore,
): Promise<void> {
  const cfg = config ?? new ConfigManager();
  const creds = store ?? new CredentialStore();
  const profile = cfg.getActiveProfile();
  const gatewayUrl = cfg.getAgentGatewayUrl(profile).replace(/\/$/, '');

  const cred = creds.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
    return;
  }
  const token = cred.token;

  // Find Claude Code binary
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    fail(
      'Claude Code not found. Install it from https://claude.ai/download or ensure `claude` is in your PATH.',
    );
    return;
  }

  console.log(chalk.dim(`Looking up session matching "${prefix}"...`));
  const sessions = await fetchSessions(gatewayUrl, token);
  const matches = sessions.filter((s) => s.id.startsWith(prefix));

  if (matches.length === 0) {
    console.error(chalk.red(`No session found matching "${prefix}".`));
    if (sessions.length > 0) {
      console.log(chalk.dim('\nAvailable sessions:'));
      for (const s of sessions.slice(0, 10)) {
        const agent = s.agentId ? chalk.cyan(s.agentId) : chalk.dim('unknown');
        const msgs = s.messageCount != null ? ` (${s.messageCount} msgs)` : '';
        console.log(`  ${chalk.bold(s.id.slice(0, 8))}  ${agent}${msgs}`);
      }
    }
    process.exitCode = 1;
    return;
  }

  if (matches.length > 1) {
    console.error(chalk.yellow(`Ambiguous prefix "${prefix}" — ${matches.length} matches:`));
    for (const s of matches) {
      const agent = s.agentId ? chalk.cyan(s.agentId) : chalk.dim('unknown');
      const msgs = s.messageCount != null ? ` (${s.messageCount} msgs)` : '';
      console.log(`  ${chalk.bold(s.id.slice(0, 8))}  ${s.id}  ${agent}${msgs}`);
    }
    console.log(chalk.dim('\nProvide more characters to disambiguate.'));
    process.exitCode = 1;
    return;
  }

  const session = matches[0];
  const agentId = session.agentId;

  if (!agentId) {
    console.error(chalk.red(`Session ${session.id} has no associated agent ID.`));
    process.exitCode = 1;
    return;
  }

  // Fetch conversation history and build summary
  console.log(chalk.dim('Loading conversation history...'));
  const messages = await fetchSessionMessages(gatewayUrl, token, agentId, session.id);
  const summaryText = buildConversationSummary(messages, agentId, session.id);

  console.log(
    chalk.green(
      `Launching Claude Code with session ${chalk.bold(session.id.slice(0, 8))} (agent: ${chalk.cyan(agentId)})`,
    ),
  );
  console.log(chalk.dim(`  Gateway: ${gatewayUrl}/claude-compat`));
  console.log(chalk.dim(`  Claude:  ${claudePath}`));
  console.log();

  // Spawn real Claude Code with gateway routing
  const child = spawn(
    claudePath,
    ['--append-system-prompt', summaryText],
    {
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: `${gatewayUrl}/claude-compat`,
        ANTHROPIC_AUTH_TOKEN: token,
        ANTHROPIC_CUSTOM_HEADERS: `X-Session-Id: ${session.id}\nX-Agent-Id: ${agentId}`,
        ANTHROPIC_CUSTOM_MODEL_OPTION: 'rickydata-agent',
        ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'rickydata TEE Agent',
        ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: `Session ${session.id.slice(0, 8)} via TEE`,
        API_TIMEOUT_MS: '3000000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
      stdio: 'inherit',
    },
  );

  // Wait for Claude Code to exit, propagate exit code
  await new Promise<void>((resolve) => {
    child.on('close', (code) => {
      process.exitCode = code ?? 0;
      resolve();
    });
    child.on('error', (err) => {
      console.error(chalk.red(`Failed to launch Claude Code: ${err.message}`));
      process.exitCode = 1;
      resolve();
    });
  });
}
