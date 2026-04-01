import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { CliError, fail } from '../errors.js';

/** ~/.knowledgeflow/config.json — the file plugin hooks read from */
const KF_CONFIG_DIR = path.join(os.homedir(), '.knowledgeflow');
const KF_CONFIG_FILE = path.join(KF_CONFIG_DIR, 'config.json');

/** Default KFDB API */
const DEFAULT_API_URL = 'http://34.60.37.158';

interface KfConfig {
  api_url?: string;
  api_key?: string;
  enabled?: boolean;
  tenant_id?: string;
  [key: string]: unknown;
}

function readKfConfig(): KfConfig {
  if (!fs.existsSync(KF_CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(KF_CONFIG_FILE, 'utf-8')) as KfConfig;
  } catch {
    return {};
  }
}

function writeKfConfig(config: KfConfig): void {
  if (!fs.existsSync(KF_CONFIG_DIR)) {
    fs.mkdirSync(KF_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(KF_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function requireAuth(store: CredentialStore, profile: string): { token: string; walletAddress: string } {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return { token: cred.token, walletAddress: cred.walletAddress };
}

export function createTrackingCommands(config: ConfigManager, store: CredentialStore): Command {
  const tracking = new Command('tracking').description('Manage Claude Code session tracking via plugin hooks');

  // tracking enable
  tracking
    .command('enable')
    .description('Enable session tracking (requires prior `rickydata auth login`)')
    .option('--api-url <url>', 'Override KFDB API URL')
    .option('--profile <profile>', 'Config profile to use')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const { token, walletAddress } = requireAuth(store, profile);
      const apiUrl = (opts.apiUrl as string | undefined) ?? DEFAULT_API_URL;

      // Test KFDB connectivity
      try {
        const res = await fetch(`${apiUrl}/health`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          throw new Error(`Health check returned ${res.status}`);
        }
      } catch (err) {
        throw new CliError(
          `Cannot reach KFDB at ${apiUrl}: ${err instanceof Error ? err.message : String(err)}\n` +
          'Check your network or pass --api-url to override.'
        );
      }

      // Write to ~/.knowledgeflow/config.json
      const kfConfig = readKfConfig();
      kfConfig.api_url = apiUrl;
      kfConfig.api_key = token;
      kfConfig.enabled = true;
      kfConfig.tenant_id = walletAddress;
      writeKfConfig(kfConfig);

      console.log(chalk.green('Session tracking enabled.'));
      console.log(`  API:     ${chalk.cyan(apiUrl)}`);
      console.log(`  Tenant:  ${chalk.cyan(walletAddress)}`);
      console.log(`  Config:  ${chalk.dim(KF_CONFIG_FILE)}`);
      console.log();
      console.log(chalk.dim('Plugin hooks will now send session data to KFDB.'));
      console.log(chalk.dim('Run `rickydata tracking disable` to turn off.'));
    });

  // tracking disable
  tracking
    .command('disable')
    .description('Disable session tracking')
    .action(() => {
      const kfConfig = readKfConfig();
      kfConfig.enabled = false;
      writeKfConfig(kfConfig);

      console.log(chalk.green('Session tracking disabled.'));
      console.log(chalk.dim('Plugin hooks will no longer send session data.'));
    });

  // tracking status
  tracking
    .command('status')
    .description('Show current tracking configuration')
    .action(async (opts) => {
      const kfConfig = readKfConfig();

      const hasApiKey = !!kfConfig.api_key;
      const isEnabled = kfConfig.enabled !== false && hasApiKey;

      console.log(chalk.bold('Session Tracking Status'));
      console.log(chalk.dim('-'.repeat(35)));

      if (isEnabled) {
        console.log(`  Status:  ${chalk.green('Enabled')}`);
      } else if (!hasApiKey) {
        console.log(`  Status:  ${chalk.yellow('Not configured')}`);
        console.log(chalk.dim('  Run `rickydata tracking enable` to set up.'));
      } else {
        console.log(`  Status:  ${chalk.yellow('Disabled')}`);
        console.log(chalk.dim('  Run `rickydata tracking enable` to re-enable.'));
      }

      if (kfConfig.api_url) {
        console.log(`  API:     ${chalk.cyan(kfConfig.api_url)}`);
      }

      if (kfConfig.tenant_id) {
        console.log(`  Tenant:  ${chalk.cyan(kfConfig.tenant_id)}`);
      }

      if (hasApiKey) {
        console.log(`  API Key: ${chalk.dim(kfConfig.api_key!.slice(0, 20) + '...')}`);
      }

      console.log(`  Config:  ${chalk.dim(KF_CONFIG_FILE)}`);

      // Test connectivity if enabled
      if (isEnabled && kfConfig.api_url) {
        try {
          const res = await fetch(`${kfConfig.api_url}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            console.log(`  KFDB:    ${chalk.green('Reachable')}`);
          } else {
            console.log(`  KFDB:    ${chalk.red(`Unhealthy (${res.status})`)}`);
          }
        } catch {
          console.log(`  KFDB:    ${chalk.red('Unreachable')}`);
        }
      }
    });

  return tracking;
}
