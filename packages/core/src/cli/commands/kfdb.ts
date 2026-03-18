import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';

// ── Helpers ──────────────────────────────────────────────────────────

function promptInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${hint} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

// ── KFDB Commands ────────────────────────────────────────────────────

export function createKfdbCommands(config: ConfigManager, store: CredentialStore): Command {
  const kfdb = new Command('kfdb')
    .description('KnowledgeFlow DB integration — tenant setup and development trace hooks');

  // ── rickydata kfdb init ────────────────────────────────────────────

  kfdb
    .command('init')
    .description('Set up KFDB tenant and optionally enable local development trace hooks')
    .option('--api-url <url>', 'KFDB API URL', 'http://34.60.37.158')
    .option('-y, --yes', 'Auto-accept required steps (tenant setup)')
    .action(async (opts) => {
      const kfdbUrl = opts.apiUrl;

      console.log();
      console.log(chalk.bold('KnowledgeFlow DB Setup'));
      console.log(chalk.dim('═══════════════════════'));
      console.log();

      // ── Step 1: Test Connection ──────────────────────────────────

      console.log(chalk.bold('Step 1/3: Connection'));
      console.log(chalk.dim('────────────────────'));

      const spinner = ora('Testing KFDB connection...').start();
      try {
        const res = await fetch(`${kfdbUrl}/health`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const health = await res.json() as { status: string };
        spinner.succeed(`KFDB reachable (${health.status})`);
      } catch (err) {
        spinner.fail('Cannot reach KFDB');
        console.log(chalk.dim(`  URL: ${kfdbUrl}`));
        console.log(chalk.dim(`  Error: ${err instanceof Error ? err.message : String(err)}`));
        console.log();
        console.log(chalk.yellow('Check your network or use --api-url to specify a different endpoint.'));
        process.exit(1);
      }

      console.log();

      // ── Step 2: Tenant Setup ─────────────────────────────────────

      console.log(chalk.bold('Step 2/3: Tenant'));
      console.log(chalk.dim('────────────────'));

      // Check if credentials already exist
      const kfdbConfigDir = path.join(os.homedir(), '.knowledgeflow');
      const kfdbConfigFile = path.join(kfdbConfigDir, 'config.json');
      const kfdbCredsFile = path.join(kfdbConfigDir, 'credentials.json');

      let existingConfig: Record<string, unknown> = {};
      if (fs.existsSync(kfdbConfigFile)) {
        try {
          existingConfig = JSON.parse(fs.readFileSync(kfdbConfigFile, 'utf-8'));
        } catch { /* ignore */ }
      }

      if (existingConfig.api_url && existingConfig.api_key) {
        console.log(chalk.green('✓') + ' KFDB already configured');
        console.log(chalk.dim(`  API URL: ${existingConfig.api_url}`));
        console.log(chalk.dim(`  API Key: ${String(existingConfig.api_key).slice(0, 8)}...`));

        const reconfigure = await promptYesNo('  Reconfigure?', false);
        if (!reconfigure) {
          console.log(chalk.dim('  Keeping existing configuration.'));
          console.log();
          // Skip to step 3
          await promptHooksSetup(kfdbConfigDir, kfdbConfigFile, existingConfig);
          return;
        }
      }

      // Get or generate API key
      console.log(chalk.dim('An API key authenticates your local tools with KFDB.'));
      console.log(chalk.dim('You can get one from your KFDB admin or use username-based auth.'));
      console.log();

      const authChoice = await promptInput(
        `Auth method — ${chalk.cyan('(1)')} API key  ${chalk.cyan('(2)')} Username [1]: `
      );

      const newConfig: Record<string, unknown> = { ...existingConfig, api_url: kfdbUrl };

      if (authChoice === '2') {
        const username = await promptInput('Username: ');
        if (!username) {
          console.log(chalk.red('Username required.'));
          process.exit(1);
        }
        newConfig.username = username;
        delete newConfig.api_key;
        console.log(chalk.green('✓') + ` Username auth configured for ${chalk.cyan(username)}`);
      } else {
        const apiKey = await promptInput('API key: ');
        if (!apiKey) {
          console.log(chalk.red('API key required.'));
          process.exit(1);
        }
        newConfig.api_key = apiKey;
        delete newConfig.username;

        // Verify the key works
        const verifySpinner = ora('Verifying API key...').start();
        try {
          const res = await fetch(`${kfdbUrl}/api/v1/entities/labels`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          verifySpinner.succeed('API key verified');
        } catch {
          verifySpinner.fail('API key verification failed');
          const proceed = await promptYesNo('  Save anyway?', false);
          if (!proceed) process.exit(1);
        }
      }

      // Save config
      if (!fs.existsSync(kfdbConfigDir)) {
        fs.mkdirSync(kfdbConfigDir, { recursive: true });
      }
      fs.writeFileSync(kfdbConfigFile, JSON.stringify(newConfig, null, 2) + '\n');
      console.log(chalk.green('✓') + ` Config saved to ${chalk.dim(kfdbConfigFile)}`);

      console.log();

      // ── Step 3: Optional Hooks ───────────────────────────────────

      await promptHooksSetup(kfdbConfigDir, kfdbConfigFile, newConfig);
    });

  // ── rickydata kfdb status ──────────────────────────────────────────

  kfdb
    .command('status')
    .description('Check KFDB connection, tenant, and hooks status')
    .option('--gateway <url>', 'MCP gateway URL', 'https://mcp.rickydata.org')
    .action(async (opts) => {
      const kfdbConfigDir = path.join(os.homedir(), '.knowledgeflow');
      const kfdbConfigFile = path.join(kfdbConfigDir, 'config.json');

      console.log();
      console.log(chalk.bold('KFDB Status'));
      console.log(chalk.dim('───────────'));

      // ── Local Config ──
      let localConfigured = false;
      if (fs.existsSync(kfdbConfigFile)) {
        const cfg = JSON.parse(fs.readFileSync(kfdbConfigFile, 'utf-8'));
        localConfigured = true;
        console.log(chalk.green('✓') + ` Config: ${chalk.dim(kfdbConfigFile)}`);
        console.log(chalk.dim(`  API URL: ${cfg.api_url || '(not set)'}`));
        console.log(chalk.dim(`  Auth: ${cfg.api_key ? 'API key' : cfg.username ? `Username (${cfg.username})` : '(none)'}`));
        console.log(chalk.dim(`  Hooks enabled: ${cfg.enabled !== false ? 'yes' : 'no'}`));
        if (cfg.excluded_directories?.length > 0) {
          console.log(chalk.dim(`  Excluded dirs: ${cfg.excluded_directories.join(', ')}`));
        }
      } else {
        console.log(chalk.dim('✗') + ' Local config: not found');
        console.log(chalk.dim('  Run ' + chalk.cyan('rickydata kfdb init') + ' for direct API access'));
      }

      // ── Direct Connection ──
      if (localConfigured) {
        const cfg = JSON.parse(fs.readFileSync(kfdbConfigFile, 'utf-8'));
        const spinner = ora('Testing direct connection...').start();
        try {
          const res = await fetch(`${cfg.api_url}/health`, { signal: AbortSignal.timeout(5000) });
          const health = await res.json() as { status: string };
          spinner.succeed(`Direct API: ${health.status}`);
        } catch {
          spinner.fail('Direct API: unreachable');
        }
      }

      // ── Marketplace Tenant (wallet-based) ──
      console.log();
      console.log(chalk.bold('Marketplace Tenant'));
      console.log(chalk.dim('──────────────────'));

      const cred = store.getToken();
      if (!cred) {
        console.log(chalk.dim('✗') + ' Not authenticated via marketplace');
        console.log(chalk.dim('  Run ' + chalk.cyan('rickydata auth login') + ' to connect your wallet'));
      } else {
        const wallet = cred.walletAddress || '(unknown)';
        console.log(chalk.green('✓') + ` Wallet: ${chalk.cyan(wallet)}`);

        // Query tenant_status via gateway
        const gatewayUrl = (opts.gateway as string).replace(/\/$/, '');
        const KFDB_SERVER_ID = '217fc28a-675c-45b8-a7f4-4ac9c674ff9d';

        const spinner = ora('Fetching tenant status...').start();
        try {
          const res = await fetch(
            `${gatewayUrl}/api/servers/${KFDB_SERVER_ID}/tools/tenant_status`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cred.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({}),
              signal: AbortSignal.timeout(15000),
            }
          );

          if (res.status === 402) {
            spinner.succeed('Tenant: active (payment required for status query)');
            console.log(chalk.dim('  Use the MCP marketplace to call tenant_status with x402 payment'));
          } else if (res.ok) {
            const result = await res.json() as {
              content?: Array<{ text?: string }>;
            };
            const text = result.content?.[0]?.text;
            if (text) {
              const status = JSON.parse(text);
              spinner.succeed('Tenant: active');
              console.log(chalk.dim(`  Tenant ID: ${status.tenant_id || '(provisioning)'}`));
              console.log(chalk.dim(`  Keyspace: ${status.keyspace || '(pending)'}`));
              console.log(chalk.dim(`  Tier: ${status.tier || 'free'}`));
              if (status.usage) {
                const u = status.usage;
                const q = status.quota || {};
                const nodesPct = q.max_nodes ? ` (${((u.nodes / q.max_nodes) * 100).toFixed(1)}%)` : '';
                const storageMb = u.estimated_storage_bytes
                  ? `${(u.estimated_storage_bytes / 1048576).toFixed(1)} MB`
                  : '0 MB';
                const quotaMb = q.max_storage_bytes
                  ? `${(q.max_storage_bytes / 1048576).toFixed(0)} MB`
                  : '?';
                console.log(chalk.dim(`  Nodes: ${u.nodes || 0}/${q.max_nodes || '?'}${nodesPct}`));
                console.log(chalk.dim(`  Edges: ${u.edges || 0}/${q.max_edges || '?'}`));
                console.log(chalk.dim(`  Storage: ${storageMb} / ${quotaMb}`));
              }
            } else {
              spinner.succeed('Tenant: active');
            }
          } else {
            const body = await res.text().catch(() => '');
            spinner.warn(`Tenant status: HTTP ${res.status}`);
            if (body) console.log(chalk.dim(`  ${body.slice(0, 120)}`));
          }
        } catch (err) {
          spinner.warn('Could not fetch tenant status');
          console.log(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
        }
      }

      // ── Hooks ──
      console.log();
      const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      if (fs.existsSync(claudeSettingsPath)) {
        const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
        const hasHooks = settings.hooks?.SessionStart || settings.hooks?.UserPromptSubmit;
        if (hasHooks) {
          console.log(chalk.green('✓') + ' Session tracking hooks: active');
        } else {
          console.log(chalk.dim('✗') + ' Session tracking hooks: not configured');
        }
      }

      // Queue
      const queueDir = path.join(kfdbConfigDir, 'queue');
      if (fs.existsSync(queueDir)) {
        const queueCount = fs.readdirSync(queueDir).filter(f => f.endsWith('.json')).length;
        if (queueCount > 0) {
          console.log(chalk.yellow('!') + ` Queue: ${queueCount} pending items`);
          console.log(chalk.dim('  Run: node ~/Documents/github/knowledgeflow_plugin_kfdb/plugin/scripts/drain-queue.js'));
        } else {
          console.log(chalk.green('✓') + ' Queue: empty');
        }
      }

      console.log();
    });

  return kfdb;
}

// ── Hooks Setup Wizard ───────────────────────────────────────────────

async function promptHooksSetup(
  kfdbConfigDir: string,
  kfdbConfigFile: string,
  existingConfig: Record<string, unknown>,
): Promise<void> {
  console.log(chalk.bold('Step 3/3: Development Trace Hooks'));
  console.log(chalk.dim('─────────────────────────────────'));
  console.log();
  console.log(chalk.dim('Session trace hooks record your Claude Code conversations (prompts,'));
  console.log(chalk.dim('responses, tool calls, file edits) to KFDB for analytics and agentic'));
  console.log(chalk.dim('use cases like context injection and pattern detection.'));
  console.log();
  console.log(chalk.yellow.bold('Security Notice:'));
  console.log(chalk.yellow('  This feature is OPTIONAL and NOT required for KFDB to work.'));
  console.log(chalk.yellow('  If enabled, conversation content is sent to your KFDB instance.'));
  console.log(chalk.yellow('  A secrets sanitizer (6-layer detection) redacts known token'));
  console.log(chalk.yellow('  formats, but cannot guarantee all secrets are caught.'));
  console.log(chalk.yellow('  .env files are never stored. For maximum security, do NOT'));
  console.log(chalk.yellow('  enable this if you work with highly sensitive credentials.'));
  console.log();

  const enableHooks = await promptYesNo('Enable development trace hooks?', false);

  if (!enableHooks) {
    console.log();
    console.log(chalk.dim('Hooks not enabled. You can enable them later with:'));
    console.log(chalk.cyan('  rickydata kfdb init'));
    console.log();
    console.log(chalk.bold('Setup complete!'));
    console.log();
    return;
  }

  // Check if knowledgeflow_plugin_kfdb is available
  const pluginPaths = [
    path.join(os.homedir(), 'Documents', 'github', 'knowledgeflow_plugin_kfdb', 'plugin'),
    path.join(os.homedir(), 'projects', 'knowledgeflow_plugin_kfdb', 'plugin'),
  ];

  let pluginRoot: string | null = null;
  for (const p of pluginPaths) {
    if (fs.existsSync(path.join(p, 'hooks', 'hooks.json'))) {
      pluginRoot = p;
      break;
    }
  }

  if (!pluginRoot) {
    const customPath = await promptInput(
      'Plugin not found. Enter path to knowledgeflow_plugin_kfdb/plugin: '
    );
    if (customPath && fs.existsSync(path.join(customPath, 'hooks', 'hooks.json'))) {
      pluginRoot = customPath;
    } else {
      console.log(chalk.red('Plugin not found. Clone it first:'));
      console.log(chalk.cyan('  git clone https://github.com/rickycambrian/knowledgeflow_plugin_kfdb'));
      console.log();
      return;
    }
  }

  console.log(chalk.green('✓') + ` Plugin found at ${chalk.dim(pluginRoot)}`);

  // Install hooks into Claude Code settings
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let claudeSettings: Record<string, unknown> = {};

  if (fs.existsSync(claudeSettingsPath)) {
    try {
      claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
    } catch { /* fresh settings */ }
  }

  // Set the env var for hooks
  if (!claudeSettings.env) claudeSettings.env = {};
  (claudeSettings.env as Record<string, string>).KFDB_PLUGIN_ROOT = pluginRoot;

  // Add hooks if not present
  if (!claudeSettings.hooks) claudeSettings.hooks = {};
  const hooks = claudeSettings.hooks as Record<string, unknown[]>;

  const hookDefs: Record<string, unknown[]> = {
    SessionStart: [{ hooks: [{ type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/smart-install.js" && node "$KFDB_PLUGIN_ROOT/scripts/session-start.js"`, timeout: 60 }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/session-end.js"`, timeout: 30 }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/track-messages.js"`, timeout: 10 }] }],
    Stop: [{ hooks: [{ type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/track-messages.js"`, timeout: 10 }] }],
    PostToolUse: [
      { matcher: '*', hooks: [
        { type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/ensure-session.js"`, timeout: 15 },
        { type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/track-tool-calls.js"`, timeout: 10 },
      ]},
      { matcher: 'Edit|MultiEdit|Write', hooks: [
        { type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/track-file-edit.js"`, timeout: 60 },
      ]},
      { matcher: 'Bash', hooks: [
        { type: 'command', command: `node "$KFDB_PLUGIN_ROOT/scripts/track-git.js"`, timeout: 15 },
      ]},
    ],
  };

  for (const [event, def] of Object.entries(hookDefs)) {
    if (!hooks[event]) {
      hooks[event] = def;
    }
  }

  // Save Claude settings
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  fs.writeFileSync(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2) + '\n');
  console.log(chalk.green('✓') + ' Hooks installed in Claude Code settings');

  // Ensure knowledgeflow config has enabled: true
  const updatedConfig = { ...existingConfig, enabled: true };
  fs.writeFileSync(kfdbConfigFile, JSON.stringify(updatedConfig, null, 2) + '\n');
  console.log(chalk.green('✓') + ' Trace tracking enabled');

  // Ask about directory exclusions
  console.log();
  console.log(chalk.dim('You can exclude specific directories from tracking.'));
  const excludeDirs = await promptYesNo('Exclude any directories?', false);

  if (excludeDirs) {
    const dirs = await promptInput('Directories to exclude (comma-separated): ');
    if (dirs) {
      const excluded = dirs.split(',').map(d => d.trim()).filter(Boolean);
      const finalConfig = { ...updatedConfig, excluded_directories: excluded };
      fs.writeFileSync(kfdbConfigFile, JSON.stringify(finalConfig, null, 2) + '\n');
      console.log(chalk.green('✓') + ` Excluded: ${excluded.join(', ')}`);
    }
  }

  console.log();
  console.log(chalk.bold('Setup complete!'));
  console.log();
  console.log(chalk.dim('Restart Claude Code for hooks to take effect.'));
  console.log(chalk.dim('Check status anytime: ') + chalk.cyan('rickydata kfdb status'));
  console.log();
}
