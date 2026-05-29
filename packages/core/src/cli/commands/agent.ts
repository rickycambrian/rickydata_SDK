import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import { AgentBuilder } from '../../agent/agent-builder.js';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { fail } from '../errors.js';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred || !cred.token) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

/**
 * Collect `--secret NAME=value` / `--mcp-secret SERVER:NAME=value` repeated
 * flags into the maps deployRecipe expects. Values may also be loaded from a
 * JSON file via `--secrets-file`.
 */
function parseSecretFlags(values: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of values ?? []) {
    const eq = entry.indexOf('=');
    if (eq === -1) fail(`Invalid --secret "${entry}". Use NAME=value.`);
    out[entry.slice(0, eq).trim()] = entry.slice(eq + 1);
  }
  return out;
}

function parseMcpSecretFlags(values: string[] | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const entry of values ?? []) {
    const colon = entry.indexOf(':');
    const eq = entry.indexOf('=');
    if (colon === -1 || eq === -1 || eq < colon) {
      fail(`Invalid --mcp-secret "${entry}". Use SERVER_ID:NAME=value.`);
    }
    const serverId = entry.slice(0, colon).trim();
    const name = entry.slice(colon + 1, eq).trim();
    const value = entry.slice(eq + 1);
    (out[serverId] ??= {})[name] = value;
  }
  return out;
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

/**
 * Attach the agent-builder subcommands (create / deploy / verify) onto the
 * existing `agents` command group, so they are reachable as
 * `rickydata agent create|deploy|verify` (the group aliases `agent`).
 * Listing is already provided by `agents list`.
 */
export function registerAgentBuilderCommands(
  agent: Command,
  config: ConfigManager,
  store: CredentialStore,
): Command {
  // ─── create ───────────────────────────────────────────────
  agent
    .command('create')
    .description('Create (or upsert) a custom agent from flags')
    .requiredOption('--name <name>', 'Agent slug/base name')
    .option('--prompt <text>', 'System prompt text')
    .option('--prompt-file <path>', 'Read system prompt from a file')
    .option('--title <title>', 'Agent title')
    .option('--description <desc>', 'One-line description')
    .option('--model <model>', 'Model (haiku|sonnet|opus|...)')
    .option('--category <category>', 'Category')
    .option('--mcp-server <id>', 'MCP server id/name to attach (repeatable)', collect, [])
    .option('--kb-tools', 'Enable gateway-native KnowledgeBook (KFDB) tools', false)
    .option('--json', 'Print the result as JSON', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      let systemPrompt = opts.prompt ?? '';
      if (opts.promptFile) systemPrompt = await fs.readFile(opts.promptFile, 'utf8');
      if (!systemPrompt.trim()) fail('A system prompt is required. Pass --prompt or --prompt-file.');

      const builder = new AgentBuilder({ token, gatewayUrl });
      const result = await builder.createAgent({
        name: opts.name,
        systemPrompt,
        title: opts.title,
        description: opts.description,
        model: opts.model,
        category: opts.category,
        mcpServers: opts.mcpServer,
        kbTools: opts.kbTools,
      });

      if (opts.kbTools) {
        await builder.enableKbTools(result.agentId);
        result.kbToolsEnabled = true;
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.green(`Created agent ${chalk.bold(result.agentId)}`));
      if (result.qualityScore !== undefined) console.log(chalk.dim(`Quality score: ${result.qualityScore}`));
      if (result.kbToolsEnabled) console.log(chalk.dim('KnowledgeBook tools: enabled'));
    });

  // ─── deploy ────────────────────────────────────────────────
  agent
    .command('deploy')
    .description('Deploy an agent recipe directory (agent.md + skills/ + claude-routing.md)')
    .argument('<dir>', 'Recipe directory')
    .option('--secret <NAME=value>', 'Agent secret (repeatable)', collect, [])
    .option('--mcp-secret <SERVER:NAME=value>', 'MCP-server secret (repeatable)', collect, [])
    .option('--secrets-file <path>', 'JSON file of agent secrets ({ "NAME": "value" })')
    .option('--kb-token <token>', 'Per-agent KFDB token (reflect/kb-token)')
    .option('--skip-verify', 'Skip the post-deploy verify step', false)
    .option('--json', 'Print the result as JSON', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (dir, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      const secrets = parseSecretFlags(opts.secret);
      if (opts.secretsFile) {
        const fileSecrets = JSON.parse(await fs.readFile(opts.secretsFile, 'utf8')) as Record<string, string>;
        Object.assign(secrets, fileSecrets);
      }
      const mcpSecrets = parseMcpSecretFlags(opts.mcpSecret);

      const builder = new AgentBuilder({ token, gatewayUrl });
      const result = await builder.deployRecipe(dir, {
        secrets,
        mcpSecrets,
        kbToken: opts.kbToken,
        skipVerify: opts.skipVerify,
        onStep: opts.json ? undefined : (step, detail) => {
          process.stderr.write(chalk.dim(`  → ${step}${detail ? ` (${detail})` : ''}\n`));
        },
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(chalk.green(`Deployed agent ${chalk.bold(result.agentId)}`));
      if (result.uploadedSkills.length) console.log(chalk.dim(`Skills: ${result.uploadedSkills.join(', ')}`));
      if (result.claudeRoutingUploaded) console.log(chalk.dim('CLAUDE routing: uploaded'));
      if (result.agentSecretsSet.length) console.log(chalk.dim(`Agent secrets: ${result.agentSecretsSet.join(', ')}`));
      if (result.mcpSecretsSet.length) console.log(chalk.dim(`MCP secrets: ${result.mcpSecretsSet.join(', ')}`));
      if (result.kbToolsEnabled) console.log(chalk.dim('KnowledgeBook tools: enabled'));
      if (result.reflectConfigured) console.log(chalk.dim('Reflect: configured'));
    });

  // ─── verify ────────────────────────────────────────────────
  agent
    .command('verify')
    .description('Verify a provisioned agent (existence, skills, MCP tools, secrets, kb-tools)')
    .argument('<agentId>', 'Agent id')
    .option('--chat <message>', 'Also send a chat probe and print the response')
    .option('--model <model>', 'Model for the chat probe')
    .option('--json', 'Print the result as JSON', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (agentId, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      const builder = new AgentBuilder({ token, gatewayUrl });
      const result = await builder.verify(agentId);

      let chatResult: { text: string; toolCalls: string[] } | undefined;
      if (opts.chat) {
        const probe = await builder.chatProbe(agentId, opts.chat, { model: opts.model });
        chatResult = { text: probe.text, toolCalls: probe.toolCalls };
      }

      if (opts.json) {
        console.log(JSON.stringify({ ...result, chat: chatResult }, null, 2));
        return;
      }
      console.log(`Agent ${chalk.bold(agentId)}: ${result.exists ? chalk.green('exists') : chalk.red('not found')}`);
      console.log(chalk.dim(`Skills: ${result.skills.length ? result.skills.join(', ') : '(none)'}`));
      console.log(chalk.dim(`MCP tools: ${result.tools.length ? result.tools.join(', ') : '(none)'}`));
      if (result.secretStatus) {
        console.log(chalk.dim(`Secrets ready: ${result.secretStatus.ready} (missing: ${result.secretStatus.missingRequired.join(', ') || 'none'})`));
      }
      if (result.kbToolsEnabled !== undefined) console.log(chalk.dim(`KnowledgeBook tools: ${result.kbToolsEnabled}`));
      if (result.reflect) console.log(chalk.dim(`Reflect enabled: ${result.reflect.reflectEnabled} (kbAuthConfigured: ${result.reflect.kbAuthConfigured})`));
      if (chatResult) {
        console.log(chalk.bold('\nChat probe:'));
        console.log(chatResult.text);
        if (chatResult.toolCalls.length) console.log(chalk.dim(`Tool calls: ${chatResult.toolCalls.join(', ')}`));
      }
    });

  // `list` is provided by the existing `agents list` subcommand (reachable as
  // `rickydata agent list` via the group alias), so it is not redefined here.

  return agent;
}
