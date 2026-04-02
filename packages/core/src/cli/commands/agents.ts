import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFileSync } from 'child_process';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { AgentClient } from '../../agent/agent-client.js';
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

// ── Provider Detection ────────────────────────────────────────────────

interface ProviderInfo {
  label: string;
  isMinimax: boolean;
  isAnthropic: boolean;
}

async function detectProvider(token: string, gatewayUrl: string): Promise<ProviderInfo> {
  const client = new AgentClient({ token, gatewayUrl });

  try {
    const settings = await client.getWalletSettings();

    if (settings.plan === 'free' || settings.modelProvider === 'minimax') {
      return { label: 'MiniMax (free tier)', isMinimax: true, isAnthropic: false };
    }

    if (settings.plan === 'byok') {
      const provider = settings.modelProvider ?? 'anthropic';
      if (provider === 'minimax') {
        return { label: 'MiniMax (BYOK)', isMinimax: true, isAnthropic: false };
      }
      return { label: 'Anthropic (BYOK)', isMinimax: false, isAnthropic: true };
    }

    // Plan not set — probe API key
    try {
      const keyStatus = await client.getApiKeyStatus();
      if (keyStatus.configured) {
        return { label: 'Anthropic (BYOK)', isMinimax: false, isAnthropic: true };
      }
    } catch {
      // fall through
    }

    return { label: 'MiniMax (free tier)', isMinimax: true, isAnthropic: false };
  } catch {
    // Wallet settings unavailable
    try {
      const keyStatus = await client.getApiKeyStatus();
      if (keyStatus.configured) {
        return { label: 'Anthropic (BYOK)', isMinimax: false, isAnthropic: true };
      }
    } catch { /* both failed */ }

    return { label: 'MiniMax (free tier)', isMinimax: true, isAnthropic: false };
  }
}

// ── Choice Prompt ─────────────────────────────────────────────────────

function promptChoice(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Find claude binary ────────────────────────────────────────────────

function findClaude(): string | null {
  try {
    const result = execFileSync('which', ['claude'], { stdio: 'pipe', encoding: 'utf-8' }) as string;
    return result.trim() || null;
  } catch {
    return null;
  }
}

// ── Ensure rickydata MCP connected ────────────────────────────────────

function ensureMcpConnected(token: string): void {
  try {
    const listOut = execFileSync('claude', ['mcp', 'list'], { stdio: 'pipe', encoding: 'utf-8' }) as string;

    if (!listOut.includes('rickydata')) {
      const rickyServerUrl = 'https://rickydata-mcp-server-2dbp4scmrq-uc.a.run.app';
      const args = ['mcp', 'add', '--transport', 'http', 'rickydata', `${rickyServerUrl}/mcp`];
      if (token) args.push('--header', `Authorization:Bearer ${token}`);
      execFileSync('claude', args, { stdio: 'pipe' });
      console.log(chalk.green('  ✓') + ' rickydata MCP server connected to Claude Code');
    }
  } catch {
    // claude not installed or mcp commands unavailable — skip silently
  }
}

export function createAgentsCommands(config: ConfigManager, store: CredentialStore): Command {
  const agents = new Command('agents').alias('agent').description('Manage and explore agents');

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

  // agents use <id>
  agents
    .command('use <id>')
    .description('Use an agent with Claude Code (Gateway or Local+Teammate mode)')
    .option('--profile <profile>', 'Profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (id: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const cred = store.getToken(profile);

      if (!cred) {
        throw new CliError('Not authenticated. Run `rickydata auth login` first.');
      }
      const token = cred.token;

      // Fetch agent metadata
      const spinner = ora(`Fetching agent '${id}'...`).start();
      let agent: AgentInfo;
      try {
        agent = await fetchAgent(gatewayUrl, id, token);
        spinner.stop();
      } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch agent '${id}'`));
        throw new CliError(err instanceof Error ? err.message : String(err));
      }

      // Detect provider
      const providerSpinner = ora('Detecting your provider...').start();
      let provider: ProviderInfo;
      try {
        provider = await detectProvider(token, gatewayUrl);
        providerSpinner.stop();
      } catch {
        providerSpinner.stop();
        provider = { label: 'MiniMax (free tier)', isMinimax: true, isAnthropic: false };
      }

      const SEP = chalk.dim('─'.repeat(46));

      // Header
      console.log();
      console.log(`  ${chalk.bold('rickydata')} ${chalk.dim('— Agent Setup')}`);
      console.log(`  ${SEP}`);
      console.log();
      console.log(`  Agent: ${chalk.cyan(agent.id)} ${chalk.dim('(' + (agent.name ?? agent.id) + ')')}`);
      console.log(`  Your provider: ${chalk.cyan(provider.label)}`);
      console.log();

      // Provider warning
      if (provider.isMinimax) {
        console.log(`  ${chalk.yellow('⚠')}  MiniMax is a Chinese AI provider. Use your judgement`);
        console.log(`     about the content you share with the LLM.`);
        console.log();
        console.log(`     To switch to Anthropic: ${chalk.cyan('rickydata apikey set')}`);
      } else if (provider.isAnthropic) {
        console.log(`  ${chalk.blue('ℹ')}  Pay-as-you-go pricing applies. Manage billing at:`);
        console.log(`     ${chalk.cyan('https://rickydata.org/wallet')}`);
      }

      console.log();
      console.log(`  ${SEP}`);
      console.log();
      console.log(`  How would you like to use this agent?`);
      console.log();
      console.log(`  ${chalk.bold('(1) Gateway Claude Code')} ${chalk.dim('— Run Claude Code through the')}`);
      console.log(`      ${chalk.dim('rickydata TEE gateway. The agent\'s knowledge and tools')}`);
      console.log(`      ${chalk.dim('are available directly. Uses your current provider.')}`);
      console.log();
      console.log(`  ${chalk.bold('(2) Local Claude Code + Agent Teammate')} ${chalk.dim('— Use your own')}`);
      console.log(`      ${chalk.dim('Claude Code subscription (e.g. Claude Max). The agent')}`);
      console.log(`      ${chalk.dim('is available as a teammate that delegates work to the')}`);
      console.log(`      ${chalk.dim('rickydata gateway (essentially free).')}`);
      console.log();

      const choice = await promptChoice('  Choice [1/2]: ');

      if (choice === '1') {
        // Option 1: Gateway Claude Code
        const claudePath = findClaude() ?? 'claude';

        console.log();
        console.log(chalk.green('  ✓') + ' Launching Gateway Claude Code...');
        console.log(chalk.dim(`  Routing through rickydata TEE gateway with agent: ${id}`));
        console.log();

        const child = spawn(claudePath, [
          '--append-system-prompt',
          `You have access to the ${id} agent. Use mcp__claude_ai_rickydata__agent_chat with agentId: "${id}" to delegate work to this specialist agent (${agent.name ?? id}). When a task requires specialized knowledge, always delegate to this agent first.`,
        ], {
          env: {
            ...process.env,
            ANTHROPIC_BASE_URL: 'https://agents.rickydata.org/claude-compat',
            ANTHROPIC_AUTH_TOKEN: token,
            ANTHROPIC_CUSTOM_MODEL_OPTION: 'rickydata-agent',
            API_TIMEOUT_MS: '3000000',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          },
          stdio: 'inherit',
        });

        child.on('error', (err) => {
          console.error(chalk.red(`Failed to launch claude: ${err.message}`));
          console.log(chalk.dim('Make sure Claude Code is installed: https://claude.com/claude-code'));
          process.exit(1);
        });

        child.on('exit', (code) => {
          process.exit(code ?? 0);
        });

      } else if (choice === '2') {
        // Option 2: Local Claude Code + Agent Teammate
        console.log();

        // Ensure MCP server connected
        ensureMcpConnected(token);

        // Write teammate file to .claude/agents/ in current working directory
        const agentsDir = path.join(process.cwd(), '.claude', 'agents');
        try {
          fs.mkdirSync(agentsDir, { recursive: true });
        } catch {
          // Directory may already exist
        }

        const agentName = agent.name ?? id;
        const teammateFilename = `${id}-teammate.md`;
        const teammatePath = path.join(agentsDir, teammateFilename);

        const teammateContent = [
          '---',
          `name: ${id}-teammate`,
          `description: Delegates work to the ${agentName} rickydata agent via MCP. Uses MiniMax (essentially free).`,
          'model: haiku',
          '---',
          '',
          `# ${agentName} Teammate`,
          '',
          'You delegate ALL work to the rickydata agent via:',
          '',
          '```',
          'mcp__claude_ai_rickydata__agent_chat({',
          `  agentId: "${id}",`,
          '  message: "<full task description with all context>"',
          '})',
          '```',
          '',
          'Parse the response and return the result to the lead agent or other teammates.',
          '',
          'For multi-turn work:',
          `1. Create session: mcp__claude_ai_rickydata__agent_create_session({ agent_id: "${id}" })`,
          `2. Follow-up: mcp__claude_ai_rickydata__agent_resume_session({ agent_id: "${id}", session_id: "...", message: "..." })`,
          '',
          '## Rules',
          '1. Always try MCP delegation first — it routes to MiniMax which is essentially free',
          '2. Be concise — you are a routing layer',
          '3. Return structured results — the lead agent needs actionable output',
          '4. Report failures clearly — if MCP tool fails, say so immediately',
          '',
        ].join('\n');

        fs.writeFileSync(teammatePath, teammateContent, 'utf8');

        console.log(chalk.green('  ✓') + ` Agent teammate installed at ${chalk.cyan(`.claude/agents/${teammateFilename}`)}`);
        console.log();
        console.log(`  Inside Claude Code, use this agent as a teammate:`);
        console.log(chalk.cyan(`    "Spawn a ${id}-teammate to help with <topic>"`));
        console.log();
        console.log(`  Or use directly:`);
        console.log(chalk.cyan(`    "Use agent_chat to ask ${id} about <topic>"`));
        console.log();

        // Launch claude normally
        const child = spawn('claude', [], { stdio: 'inherit' });

        child.on('error', (err) => {
          // claude may not be installed — still succeed since file was written
          console.log(chalk.yellow(`  Could not launch Claude Code: ${err.message}`));
          console.log(chalk.dim('  Install from https://claude.com/claude-code, then run: claude'));
          process.exit(0);
        });

        child.on('exit', (code) => {
          process.exit(code ?? 0);
        });

      } else {
        console.log();
        console.log(chalk.yellow('  Invalid choice. Run the command again and enter 1 or 2.'));
        process.exit(1);
      }
    });

  return agents;
}
