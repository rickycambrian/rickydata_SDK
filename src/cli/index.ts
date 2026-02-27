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
import { createMcpCommands } from './commands/mcp.js';
import { createInitCommand } from './commands/init.js';
import { toCliError } from './errors.js';
import { CLI_VERSION } from './version.js';

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
  program.addCommand(createMcpCommands(config, store));

  return program;
}

// Auto-run when executed directly (bin entry point calls this)
export async function run(argv?: string[]): Promise<void> {
  const program = createProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv ?? process.argv);
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
