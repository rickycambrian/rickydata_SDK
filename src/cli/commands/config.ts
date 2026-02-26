import { Command } from 'commander';
import chalk from 'chalk';
import { ConfigManager } from '../config/config-manager.js';
import { formatKeyValue, formatJson, type OutputFormat } from '../output/formatter.js';

export function createConfigCommands(config: ConfigManager): Command {
  const configCmd = new Command('config').description('Manage CLI configuration');

  // config set <key> <value>
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .option('--profile <profile>', 'Profile to set value in')
    .action((key: string, value: string, opts) => {
      const profile = opts.profile;
      config.set(key, value, profile);
      const activeProfile = profile ?? config.getActiveProfile();
      console.log(chalk.green(`Set ${key} = ${value} in profile '${activeProfile}'`));
    });

  // config get <key>
  configCmd
    .command('get <key>')
    .description('Get a configuration value')
    .option('--profile <profile>', 'Profile to get value from')
    .action((key: string, opts) => {
      const value = config.get(key, opts.profile);
      if (value === undefined) {
        console.log(chalk.yellow(`Key '${key}' not found`));
      } else {
        console.log(String(value));
      }
    });

  // config list
  configCmd
    .command('list')
    .description('Show all configuration values')
    .option('--profile <profile>', 'Profile to list')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .action((opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const values = config.list(profile);

      console.log(`Profile: ${chalk.cyan(profile)}`);
      if (Object.keys(values).length === 0) {
        console.log(chalk.dim('(empty)'));
        return;
      }

      if (opts.format === 'json') {
        console.log(formatJson(values));
      } else {
        const displayValues: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(values)) {
          displayValues[k] = v;
        }
        console.log(formatKeyValue(displayValues));
      }
    });

  // config activate <profile>
  configCmd
    .command('activate <profile>')
    .description('Switch the active profile')
    .action((profile: string) => {
      config.setActiveProfile(profile);
      console.log(chalk.green(`Active profile set to '${profile}'`));
    });

  // config profiles
  configCmd
    .command('profiles')
    .description('List available profiles')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .action((opts) => {
      const profiles = config.listProfiles();
      const active = config.getActiveProfile();

      if ((opts.format as OutputFormat) === 'json') {
        console.log(formatJson({ active, profiles }));
        return;
      }

      console.log(`Active profile: ${chalk.cyan(active)}\n`);
      for (const p of profiles) {
        const marker = p === active ? chalk.green('* ') : '  ';
        console.log(`${marker}${p}`);
      }
    });

  return configCmd;
}
