import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
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

// ── Arrow-Key Selector ───────────────────────────────────────────────

function promptSelector(options: { label: string; description: string }[]): Promise<number> {
  let selected = 0;
  let firstRender = true;

  const render = () => {
    // Move cursor up to overwrite previous render (skip on first)
    if (!firstRender) {
      process.stdout.write(`\x1b[${options.length + 1}A`);
    }
    firstRender = false;

    for (let i = 0; i < options.length; i++) {
      const prefix = i === selected ? chalk.cyan('  ❯ ') : '    ';
      const label = i === selected ? chalk.bold.cyan(options[i].label) : options[i].label;
      const desc = chalk.dim(options[i].description);
      process.stdout.write(`\x1b[2K${prefix}${label} ${desc}\n`);
    }
    process.stdout.write(`\x1b[2K  ${chalk.dim('↑↓ to select, Enter to confirm')}\n`);
  };

  render();

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive fallback — pick first option
      resolve(0);
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handler = (key: Buffer) => {
      const k = key.toString();
      if (k === '\x1b[A' || k === 'k') { // Up arrow or k
        selected = (selected - 1 + options.length) % options.length;
        render();
      } else if (k === '\x1b[B' || k === 'j') { // Down arrow or j
        selected = (selected + 1) % options.length;
        render();
      } else if (k === '\r' || k === '\n') { // Enter
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        console.log();
        resolve(selected);
      } else if (k === '\x03') { // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(0);
      }
    };

    process.stdin.on('data', handler);
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
    .option('--dangerously-skip-permissions', 'Skip permission prompts in Claude Code')
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

      const selected = await promptSelector([
        { label: 'Gateway Claude Code', description: '— agent runs through rickydata TEE gateway' },
        { label: 'Local Claude Code + Agent Teammate', description: '— your subscription + free agent delegate' },
      ]);

      if (selected === 0) {
        // Option 1: Gateway Claude Code
        const claudePath = findClaude() ?? 'claude';

        console.log();
        console.log(chalk.green('  ✓') + ' Launching Gateway Claude Code...');
        console.log(chalk.dim(`  Routing through rickydata TEE gateway as: ${agent.name ?? id}`));
        console.log();

        // Build rich identity prompt so Claude Code acts AS the agent
        const agentName = agent.name ?? id;
        const skillsList = (agent.skills ?? []).map((s: string | SkillInfo) =>
          typeof s === 'string' ? s : s.name,
        ).join(', ');
        const systemPrompt = [
          `You ARE the ${agentName} agent, provided by rickydata.`,
          `Agent ID: ${id}`,
          agent.description ? `\nYour specialization: ${agent.description}` : '',
          skillsList ? `\nYour skills: ${skillsList}` : '',
          '',
          'IMPORTANT — Tool Usage:',
          `Your PRIMARY tool for domain queries is: mcp__claude_ai_rickydata__agent_chat with agentId: "${id}"`,
          'This tool connects to your specialized backend with live data, MCP tools, and domain knowledge.',
          'ALWAYS use agent_chat for domain-specific questions (e.g., on-chain data, protocol queries, search).',
          'Do NOT use mcp__knowledgeflow-db__* or other local MCP tools for your domain — those belong to the user\'s local setup.',
          '',
          'You also have access to the local filesystem (Read, Write, Edit, Bash) for helping with the user\'s code.',
          'Combine your domain expertise with local file access to help users with both knowledge and implementation.',
        ].filter(Boolean).join('\n');

        const gatewayArgs: string[] = ['--append-system-prompt', systemPrompt];
        if (opts.dangerouslySkipPermissions) {
          gatewayArgs.push('--dangerously-skip-permissions');
        } else {
          // Force normal permission mode — overrides global skipDangerousModePermissionPrompt
          gatewayArgs.push('--permission-mode', 'default');
        }

        const child = spawn(claudePath, gatewayArgs, {
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

      } else {
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

        // Launch claude normally (user's own subscription)
        const localArgs: string[] = [];
        if (opts.dangerouslySkipPermissions) {
          localArgs.push('--dangerously-skip-permissions');
        } else {
          localArgs.push('--permission-mode', 'default');
        }

        const child = spawn('claude', localArgs, { stdio: 'inherit' });

        child.on('error', (err) => {
          // claude may not be installed — still succeed since file was written
          console.log(chalk.yellow(`  Could not launch Claude Code: ${err.message}`));
          console.log(chalk.dim('  Install from https://claude.com/claude-code, then run: claude'));
          process.exit(0);
        });

        child.on('exit', (code) => {
          process.exit(code ?? 0);
        });
      }
    });

  return agents;
}
