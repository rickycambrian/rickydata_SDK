import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatOutput, formatJson, type OutputFormat } from '../output/formatter.js';
import { startChatRepl } from '../chat/chat-repl.js';
import { CliError, fail } from '../errors.js';

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

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

async function fetchSessions(gatewayUrl: string, token: string, agentId?: string): Promise<SessionInfo[]> {
  const path = agentId
    ? `/agents/${encodeURIComponent(agentId)}/sessions`
    : '/wallet/sessions';
  const res = await fetch(`${gatewayUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to list sessions: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.sessions ?? data.items ?? [];
}

async function fetchSession(gatewayUrl: string, token: string, agentId: string, sessionId: string): Promise<SessionInfo & { messages?: unknown[] }> {
  const res = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to get session: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function deleteSession(gatewayUrl: string, token: string, agentId: string, sessionId: string): Promise<void> {
  const res = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to delete session: ${res.status} ${await res.text()}`);
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

export function createSessionsCommands(config: ConfigManager, store: CredentialStore): Command {
  const sessions = new Command('sessions').description('Manage agent chat sessions');

  // sessions list [agent-id]
  sessions
    .command('list [agent-id]')
    .description('List sessions')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string | undefined, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const list = await fetchSessions(gatewayUrl, token, agentId);

        if (format === 'json') {
          console.log(formatJson(list));
          return;
        }

        if (list.length === 0) {
          console.log(chalk.yellow('No sessions found.'));
          return;
        }

        const rows = list.map((s) => ({
          id: s.id,
          agent: s.agentId ?? '',
          messages: String(s.messageCount ?? ''),
          model: s.model ?? '',
          lastActive: s.lastActive ?? (s.lastActiveAt ? new Date(s.lastActiveAt).toISOString() : s.createdAt ? new Date(s.createdAt).toISOString() : ''),
        }));

        console.log(
          formatOutput(rows, [
            { header: 'Session ID', key: 'id', width: 35 },
            { header: 'Agent', key: 'agent', width: 20 },
            { header: 'Messages', key: 'messages', width: 10 },
            { header: 'Model', key: 'model', width: 15 },
            { header: 'Last Active', key: 'lastActive', width: 25 },
          ], format)
        );
        console.log(chalk.dim(`\n${list.length} session(s)`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // sessions get <agent-id> <session-id>
  sessions
    .command('get <agent-id> <session-id>')
    .description('Show session details')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, sessionId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const session = await fetchSession(gatewayUrl, token, agentId, sessionId);

        if (format === 'json') {
          console.log(formatJson(session));
          return;
        }

        console.log(`\n${chalk.bold('Session')} ${chalk.cyan(session.id)}`);
        console.log(chalk.dim('─'.repeat(40)));
        if (session.agentId) console.log(`Agent:        ${chalk.cyan(session.agentId)}`);
        if (session.model) console.log(`Model:        ${chalk.cyan(session.model)}`);
        if (session.messageCount !== undefined) console.log(`Messages:     ${chalk.cyan(String(session.messageCount))}`);
        if (session.createdAt) console.log(`Created:      ${chalk.dim(session.createdAt)}`);
        if (session.lastActive) console.log(`Last Active:  ${chalk.dim(session.lastActive)}`);

        if (session.messages && session.messages.length > 0) {
          console.log(`\n${chalk.bold('Recent messages')}:`);
          const preview = session.messages.slice(-3);
          for (const msg of preview) {
            const m = msg as { role?: string; content?: string };
            const role = m.role ?? 'unknown';
            const content = typeof m.content === 'string'
              ? m.content.slice(0, 100) + (m.content.length > 100 ? '…' : '')
              : '[non-text]';
            const roleColor = role === 'user' ? chalk.blue : chalk.green;
            console.log(`  ${roleColor(role + '>')} ${content}`);
          }
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // sessions resume <session-id>
  sessions
    .command('resume <session-id>')
    .description('Resume a chat session in the REPL')
    .argument('<agent-id>', 'Agent ID to chat with')
    .option('--model <model>', 'Model to use (haiku|sonnet|opus)', 'haiku')
    .option('--verbose', 'Show tool call details', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (sessionId: string, agentId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      await startChatRepl({
        agentId,
        token,
        gatewayUrl,
        model: opts.model as 'haiku' | 'sonnet' | 'opus',
        sessionId,
        verbose: opts.verbose,
      });
    });

  // sessions delete <agent-id> <session-id>
  sessions
    .command('delete <agent-id> <session-id>')
    .description('Delete a session')
    .option('--yes', 'Skip confirmation prompt', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, sessionId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      if (!opts.yes) {
        const ok = await confirm(`Delete session ${sessionId}?`);
        if (!ok) {
          console.log(chalk.yellow('Cancelled.'));
          return;
        }
      }

      try {
        await deleteSession(gatewayUrl, token, agentId, sessionId);
        console.log(chalk.green(`Session ${sessionId} deleted.`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return sessions;
}
