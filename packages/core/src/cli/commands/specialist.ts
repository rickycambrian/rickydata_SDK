import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AgentClient } from '../../agent/agent-client.js';
import type { ModelGuideSpecialistFile, ModelGuideSpecialistModel } from '../../agent/types.js';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { fail } from '../errors.js';

const MAX_EXTRACTED_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 400;
const MAX_FILE_BYTES = 500 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', 'vendor']);
const TEXT_EXTENSIONS = new Set([
  'astro', 'c', 'cc', 'cfg', 'cpp', 'cs', 'css', 'csv', 'go', 'h', 'hpp', 'html',
  'java', 'js', 'json', 'jsx', 'kt', 'md', 'mjs', 'py', 'rb', 'rs', 'sql', 'svelte',
  'toml', 'tsx', 'ts', 'txt', 'xml', 'yaml', 'yml',
]);

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

function normalizeModel(value: string | undefined): ModelGuideSpecialistModel {
  if (value === 'haiku-4.5' || value === 'codex-5.5') return value;
  fail('Model must be "haiku-4.5" or "codex-5.5".');
}

function isTextPath(filePath: string): boolean {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return !!ext && TEXT_EXTENSIONS.has(ext);
}

async function collectPathFiles(inputPath: string, state: {
  files: ModelGuideSpecialistFile[];
  skippedCount: number;
  extractedBytes: number;
}): Promise<void> {
  if (state.files.length >= MAX_FILES || state.extractedBytes >= MAX_EXTRACTED_BYTES) return;
  const stat = await fs.lstat(inputPath);
  if (stat.isSymbolicLink()) {
    state.skippedCount += 1;
    return;
  }
  if (stat.isDirectory()) {
    const entries = await fs.readdir(inputPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
        state.skippedCount += 1;
        continue;
      }
      await collectPathFiles(path.join(inputPath, entry.name), state);
      if (state.files.length >= MAX_FILES || state.extractedBytes >= MAX_EXTRACTED_BYTES) break;
    }
    return;
  }
  if (!stat.isFile() || !isTextPath(inputPath) || stat.size <= 0 || stat.size > MAX_FILE_BYTES) {
    state.skippedCount += 1;
    return;
  }
  const content = await fs.readFile(inputPath, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= 0 || bytes > MAX_FILE_BYTES || state.extractedBytes + bytes > MAX_EXTRACTED_BYTES) {
    state.skippedCount += 1;
    return;
  }
  state.files.push({ content, mimeType: 'text/plain' });
  state.extractedBytes += bytes;
}

async function collectContext(paths: string[] | undefined): Promise<{
  files: ModelGuideSpecialistFile[];
  skippedCount: number;
  extractedBytes: number;
}> {
  const state = { files: [] as ModelGuideSpecialistFile[], skippedCount: 0, extractedBytes: 0 };
  for (const inputPath of paths ?? []) {
    await collectPathFiles(path.resolve(inputPath), state);
    if (state.files.length >= MAX_FILES || state.extractedBytes >= MAX_EXTRACTED_BYTES) break;
  }
  return state;
}

async function readPrompt(opts: { prompt?: string; promptFile?: string }): Promise<string> {
  if (opts.promptFile) return fs.readFile(opts.promptFile, 'utf8');
  return opts.prompt ?? '';
}

export function createSpecialistCommands(config: ConfigManager, store: CredentialStore): Command {
  const specialist = new Command('specialist').description('Run privacy-forced RickyData specialist agents');

  specialist
    .command('recommend')
    .description('Get a data-grounded model and harness recommendation')
    .option('--prompt <text>', 'Task prompt')
    .option('--prompt-file <path>', 'Read task prompt from a file')
    .option('--path <path...>', 'File or folder context to include ephemerally')
    .option('--model <model>', 'haiku-4.5 or codex-5.5', 'haiku-4.5')
    .option('--json', 'Print the final result as JSON', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const model = normalizeModel(opts.model);
      const prompt = await readPrompt(opts);
      if (!prompt.trim()) fail('A prompt is required. Pass --prompt or --prompt-file.');

      const context = await collectContext(Array.isArray(opts.path) ? opts.path : opts.path ? [opts.path] : undefined);
      const client = new AgentClient({ token, gatewayUrl });
      const result = await client.runModelGuideSpecialist({
        model,
        prompt,
        files: context.files,
        skippedCount: context.skippedCount,
      }, {
        onEvent: opts.json ? undefined : (event) => {
          if (event.type === 'status' || event.type === 'started') {
            process.stderr.write(`${event.message ?? event.type}\n`);
          }
        },
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.text) console.log(result.text);
      if (result.error) console.error(chalk.red(result.error));
      const proofHash = result.tee_proof?.manifestHash;
      if (proofHash) {
        console.log(chalk.dim(`Proof manifest: ${proofHash}`));
      }
    });

  return specialist;
}
