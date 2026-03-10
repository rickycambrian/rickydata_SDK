import { Command } from 'commander';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { startChatRepl } from '../chat/chat-repl.js';
import { fail } from '../errors.js';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

export function createChatCommand(config: ConfigManager, store: CredentialStore): Command {
  return new Command('chat')
    .description('Start an interactive chat session with an agent')
    .argument('<agent-id>', 'Agent ID to chat with')
    .option('--model <model>', 'Model to use (haiku|sonnet|opus)', 'haiku')
    .option('--session <id>', 'Resume an existing session')
    .option('--verbose', 'Show tool call details', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      await startChatRepl({
        agentId,
        token,
        gatewayUrl,
        model: opts.model as 'haiku' | 'sonnet' | 'opus',
        sessionId: opts.session,
        verbose: opts.verbose,
      });
    });
}
