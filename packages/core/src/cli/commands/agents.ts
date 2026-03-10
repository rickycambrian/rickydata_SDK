import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatOutput, formatJson, type OutputFormat } from '../output/formatter.js';
import { CliError } from '../errors.js';

interface SkillInfo {
  name: string;
  title?: string;
  description?: string;
}

interface AgentInfo {
  id: string;
  name: string;
  model: string;
  source?: string;
  description?: string;
  skills?: (string | SkillInfo)[];
  status?: string;
}

async function fetchAgents(gatewayUrl: string, token?: string): Promise<AgentInfo[]> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${gatewayUrl}/agents`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to list agents: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.agents ?? [];
}

async function fetchAgent(gatewayUrl: string, id: string, token?: string): Promise<AgentInfo> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${gatewayUrl}/agents/${encodeURIComponent(id)}`, { headers });
  if (!res.ok) {
    throw new Error(`Failed to get agent '${id}': ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function createAgentsCommands(config: ConfigManager, store: CredentialStore): Command {
  const agents = new Command('agents').description('Manage and explore agents');

  // agents list
  agents
    .command('list')
    .description('List available agents')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const cred = store.getToken(profile);
      const format = opts.format as OutputFormat;
      const isJson = format === 'json';

      const spinner = ora({ text: 'Fetching agents...', isEnabled: !isJson }).start();
      try {
        const agentList = await fetchAgents(gatewayUrl, cred?.token);
        spinner.stop();

        if (isJson) {
          console.log(formatJson(agentList));
          return;
        }

        if (agentList.length === 0) {
          console.log(chalk.yellow('No agents found.'));
          return;
        }

        const rows = agentList.map((a) => ({
          id: a.id,
          name: a.name,
          model: a.model,
          source: a.source ?? '',
          status: a.status ?? '',
        }));

        console.log(
          formatOutput(rows, [
            { header: 'ID', key: 'id', width: 30 },
            { header: 'Name', key: 'name', width: 25 },
            { header: 'Model', key: 'model', width: 20 },
            { header: 'Source', key: 'source', width: 15 },
            { header: 'Status', key: 'status', width: 12 },
          ], format)
        );
        console.log(chalk.dim(`\n${agentList.length} agent(s)`));
      } catch (err) {
        spinner.fail(chalk.red('Failed to fetch agents'));
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // agents describe <id>
  agents
    .command('describe <id>')
    .description('Show full details for an agent')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (id: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const cred = store.getToken(profile);
      const format = opts.format as OutputFormat;
      const isJson = format === 'json';

      const spinner = ora({ text: `Fetching agent '${id}'...`, isEnabled: !isJson }).start();
      try {
        const agent = await fetchAgent(gatewayUrl, id, cred?.token);
        spinner.stop();

        if (isJson) {
          console.log(formatJson(agent));
          return;
        }

        console.log(`\n${chalk.bold(agent.name ?? id)}`);
        console.log(chalk.dim('─'.repeat(40)));
        console.log(`ID:          ${chalk.cyan(agent.id)}`);
        console.log(`Model:       ${chalk.cyan(agent.model ?? '(unknown)')}`);
        if (agent.source) console.log(`Source:      ${chalk.cyan(agent.source)}`);
        if (agent.status) console.log(`Status:      ${chalk.cyan(agent.status)}`);
        if (agent.description) {
          console.log(`\nDescription:`);
          console.log(`  ${agent.description}`);
        }
        if (agent.skills && agent.skills.length > 0) {
          console.log(`\nSkills (${agent.skills.length}):`);
          for (const skill of agent.skills) {
            if (typeof skill === 'string') {
              console.log(`  - ${skill}`);
            } else {
              const label = skill.title ?? skill.name;
              console.log(`  - ${label}`);
            }
          }
        }
      } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch agent '${id}'`));
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return agents;
}
