import { Command } from 'commander';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { AgentClient } from '../../agent/agent-client.js';
import { FREE_TIER_MODEL } from '../../agent/types.js';
import { startChatRepl } from '../chat/chat-repl.js';
import { fail } from '../errors.js';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

/** Fetch the free-tier model from the backend, falling back to the constant. */
async function getFreeTierModel(client: AgentClient): Promise<string> {
  try {
    const ft = await client.getFreeTierStatus();
    return ft.model || FREE_TIER_MODEL;
  } catch {
    return FREE_TIER_MODEL;
  }
}

function defaultModelForProvider(provider: unknown): string {
  if (provider === 'openrouter') return 'google/gemma-4-26b-a4b-it';
  if (provider === 'zai') return 'glm-5.1';
  return FREE_TIER_MODEL;
}

/**
 * Resolve the model to use for chat.
 *
 * Priority: explicit flag > wallet plan > API key probe > free-tier default.
 *
 * Critical: the model string must start with 'MiniMax' (title case) for the
 * backend to route through the free-tier path. Lowercase 'minimax' does NOT work.
 */
async function resolveModel(
  token: string,
  gatewayUrl: string,
  explicitModel: string | undefined,
): Promise<string> {
  if (explicitModel) return explicitModel;

  const client = new AgentClient({ token, gatewayUrl });

  try {
    const settings = await client.getWalletSettings();

    // Explicit free plan — use the configured model provider (OpenRouter or MiniMax)
    if (settings.plan === 'free') {
      if (settings.modelProvider === 'openrouter' || settings.modelProvider === 'zai') {
        return settings.defaultModel || defaultModelForProvider(settings.modelProvider);
      }
      if (settings.modelProvider !== 'minimax') {
        client.updateWalletSettings({ modelProvider: 'minimax', defaultModel: FREE_TIER_MODEL }).catch(() => {});
      }
      return await getFreeTierModel(client);
    }

    // Explicit BYOK plan
    if (settings.plan === 'byok') {
      return settings.defaultModel || 'haiku';
    }

    // OpenRouter BYOK plan
    if (settings.plan === 'openrouter_byok') {
      return settings.defaultModel || 'google/gemma-4-26b-a4b-it';
    }

    if (settings.plan === 'zai_byok') {
      return settings.defaultModel || 'glm-5.1';
    }

    // Plan not set — probe API key to decide
    try {
      const keyStatus = await client.getApiKeyStatus();
      if (keyStatus.configured) {
        return settings.defaultModel || 'haiku';
      }
    } catch {
      // API key check failed — fall through to free tier
    }

    // No plan set + no API key → free tier
    return await getFreeTierModel(client);
  } catch {
    // Wallet settings unavailable — last resort: check API key
    try {
      const keyStatus = await client.getApiKeyStatus();
      if (keyStatus.configured) return 'haiku';
    } catch {
      // Both endpoints failed
    }
    return FREE_TIER_MODEL;
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
        model,
        sessionId: opts.session,
        verbose: opts.verbose,
      });
    });
}
