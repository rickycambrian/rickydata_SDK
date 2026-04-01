import chalk from 'chalk';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { startChatRepl } from '../chat/chat-repl.js';
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
    return; // unreachable but helps TS
  }
  const token = cred.token;

  console.log(chalk.dim(`Looking up session matching "${prefix}"...`));
  const sessions = await fetchSessions(gatewayUrl, token);
  const matches = sessions.filter(s => s.id.startsWith(prefix));

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

  console.log(chalk.green(`Resuming session ${chalk.bold(session.id.slice(0, 8))} with agent ${chalk.cyan(agentId)}`));

  await startChatRepl({
    agentId,
    token,
    gatewayUrl,
    sessionId: session.id,
  });
}
