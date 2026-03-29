import { Command } from 'commander';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { AgentClient } from '../../agent/agent-client.js';
import { startChatRepl } from '../chat/chat-repl.js';
import { fail } from '../errors.js';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

/**
 * Resolve the model to use: explicit flag > wallet settings > free-tier default > haiku.
 * Matches website behavior where free-tier users get minimax and BYOK users get their preferred model.
 */
async function resolveModel(
  token: string,
  gatewayUrl: string,
  explicitModel: string | undefined,
): Promise<string> {
  // User explicitly chose a model — respect it
  if (explicitModel) return explicitModel;

  const client = new AgentClient({ token, gatewayUrl });
  try {
    // Check wallet settings for plan + preferred model
    const settings = await client.getWalletSettings();
    if (settings.plan === 'free') {
      // Free tier — use free-tier model (matches website behavior)
      try {
        const ft = await client.getFreeTierStatus();
        return ft.model || 'minimax';
      } catch {
        return 'minimax';
      }
    }
    // BYOK — use preferred model or haiku
    return settings.defaultModel || 'haiku';
  } catch {
    // Settings unavailable — fall back to haiku
    return 'haiku';
  }
}

export function createChatCommand(config: ConfigManager, store: CredentialStore): Command {
  return new Command('chat')
    .description('Start an interactive chat session with an agent')
    .argument('<agent-id>', 'Agent ID to chat with')
    .option('--model <model>', 'Model to use (overrides wallet settings)')
    .option('--session <id>', 'Resume an existing session')
    .option('--verbose', 'Show tool call details', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      const model = await resolveModel(token, gatewayUrl, opts.model);

      await startChatRepl({
        agentId,
        token,
        gatewayUrl,
        model: model as 'haiku' | 'sonnet' | 'opus',
        sessionId: opts.session,
        verbose: opts.verbose,
      });
    });
}
