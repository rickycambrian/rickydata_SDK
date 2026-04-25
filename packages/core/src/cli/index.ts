import chalk from 'chalk';
import { Command, CommanderError } from 'commander';
import { ConfigManager } from './config/config-manager.js';
import { CredentialStore } from './config/credential-store.js';
import { createAuthCommands } from './commands/auth.js';
import { createConfigCommands } from './commands/config.js';
import { createAgentsCommands } from './commands/agents.js';
import { createChatCommand } from './commands/chat.js';
import { createSessionsCommands } from './commands/sessions.js';
import { createWalletCommands } from './commands/wallet.js';
import { createApiKeyCommands } from './commands/apikey.js';
import { createCodexCommands } from './commands/codex.js';
import { createMcpCommands } from './commands/mcp.js';
import { createCanvasCommands } from './commands/canvas.js';
import { createGitHubCommands } from './commands/github.js';
import { createKfdbCommands } from './commands/kfdb.js';
import { createTrackingCommands } from './commands/tracking.js';
import { createInitCommand } from './commands/init.js';
import { toCliError } from './errors.js';
import { CLI_VERSION } from './version.js';
import { handleResume } from './commands/resume.js';

export function createProgram(configManager?: ConfigManager, credentialStore?: CredentialStore): Command {
  const config = configManager ?? new ConfigManager();
  const store = credentialStore ?? new CredentialStore();

  const program = new Command();

  program
    .name('rickydata')
    .description('RickyData CLI — manage agents, auth, and MCP tools')
    .version(CLI_VERSION);

  program.addCommand(createInitCommand(config, store));
  program.addCommand(createAuthCommands(config, store));
  program.addCommand(createConfigCommands(config));
  program.addCommand(createAgentsCommands(config, store));
  program.addCommand(createChatCommand(config, store));
  program.addCommand(createSessionsCommands(config, store));
  program.addCommand(createWalletCommands(config, store));
  program.addCommand(createApiKeyCommands(config, store));
  program.addCommand(createCodexCommands(config, store));
  program.addCommand(createMcpCommands(config, store));
  program.addCommand(createCanvasCommands(config, store));
  program.addCommand(createGitHubCommands(config, store));
  program.addCommand(createKfdbCommands(config, store));
  program.addCommand(createTrackingCommands(config, store));

  return program;
}

// Auto-run when executed directly (bin entry point calls this)
export async function run(argv?: string[]): Promise<void> {
  const args = argv ?? process.argv;

  // Pre-parse intercept: --resume <prefix>
  const resumeIdx = args.indexOf('--resume');
  if (resumeIdx !== -1) {
    const prefix = args[resumeIdx + 1];
    if (!prefix || prefix.startsWith('-')) {
      console.error('Usage: rickydata --resume <session-id-prefix>');
      process.exitCode = 1;
      return;
    }
    await handleResume(prefix);
    return;
  }

  const program = createProgram();
  program.exitOverride();
  try {
    await program.parseAsync(args);
  } catch (error) {
    if (
      error instanceof CommanderError
      && (error.code === 'commander.helpDisplayed' || error.code === 'commander.version')
    ) {
      return;
    }

    const cliError = toCliError(error);
    console.error(chalk.red(`Error: ${cliError.message}`));
    process.exitCode = cliError.exitCode;
  }
}
