import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs/promises';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { CliError, fail } from '../errors.js';

const DEFAULT_BENCH_BASE = 'https://bench.rickydata.org';
const DEFAULT_CAMPAIGN_ID = 'benchmark_matrix_current';
// Subscription-backed default: MiniMax bills as a flat subscription so the real
// incremental spend is $0 (see rickydata Bench cost model). It is a valid,
// canonical config id in the Bench catalog and a sensible cheap default.
const DEFAULT_CONFIG_ID = 'minimax-minimax-m3-claude-code-single';

export interface ParsedIssueRef {
  repo: string;
  owner: string;
  name: string;
  issueNumber: number;
}

/**
 * Parse an `owner/repo#issue` reference. Tolerates a leading github.com host and
 * the `owner/repo/issues/123` URL shape. Throws a CliError on anything else.
 */
export function parseIssueRef(input: string): ParsedIssueRef {
  const cleaned = String(input ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '');

  const hashMatch = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)#(\d+)$/);
  const pathMatch = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/issues\/(\d+)$/i);
  const match = hashMatch ?? pathMatch;
  if (!match) {
    fail('Invalid issue reference. Expected <owner/repo#issue> (e.g. Textualize/rich#4038).');
  }

  const [, owner, name, rawIssue] = match;
  const issueNumber = Number(rawIssue);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    fail('Issue number must be a positive integer.');
  }

  return { repo: `${owner}/${name}`, owner, name, issueNumber };
}

export interface BenchRunRequestInput {
  repo: string;
  issueNumber: number;
  config: string;
  campaignId: string;
}

/**
 * Build the JSON body for POST /api/benchmarks/runs/stream. The Bench server
 * fills in visibility/scope/proof/timeout defaults; the client only supplies the
 * run coordinates (mirrors buildBenchmarkRunIntentContract on the server).
 */
export function buildBenchRunRequestBody(input: BenchRunRequestInput): Record<string, unknown> {
  return {
    repo: input.repo,
    issue_number: input.issueNumber,
    config: input.config,
    campaign_id: input.campaignId,
  };
}

export function buildCandidateIngestBody(input: { repo: string; issueNumber: number; campaignId: string }): Record<string, unknown> {
  return {
    repo: input.repo,
    campaign_id: input.campaignId,
    issue_number: input.issueNumber,
    refresh: true,
    resolve_fix_commits: true,
    publish_kfdb: true,
    closed_issue_limit: 100,
    include_all_closed_issues: false,
  };
}

function benchIssueUrl(base: string, repo: string, issueNumber: number): string {
  return `${base.replace(/\/$/, '')}/benchmarks/${repo}/issues/${issueNumber}`;
}

/** Terminal-error messages that indicate the repo/issue has no runnable fixture yet. */
function looksLikeMissingTask(message: string): boolean {
  return /not executable|not runnable|no (?:runnable )?task|task_id|resolve|fixture|not found|unknown issue|no benchmark task/i.test(
    message,
  );
}

async function resolveBearerToken(
  store: CredentialStore,
  profile: string,
  tokenFile?: string,
): Promise<string> {
  if (tokenFile) {
    try {
      const raw = (await fs.readFile(tokenFile, 'utf8')).trim();
      if (!raw) fail(`Token file is empty: ${tokenFile}`);
      return raw;
    } catch (err) {
      if (err instanceof CliError) throw err;
      fail(`Could not read token file ${tokenFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const cred = store.getToken(profile);
  if (cred?.token) return cred.token;

  fail(
    'Not authenticated. Log in first, e.g.:\n'
    + '  rickydata auth login                 # browser sign-in\n'
    + '  rickydata auth login --private-key …  # wallet key\n'
    + '  rickydata auth token create           # long-lived wallet token (mcpwt_…)\n'
    + 'Or pass a pre-minted bearer with --token-file <path>.',
  );
}

interface TerminalResult {
  run_id?: string;
  success?: boolean;
  proof_verified?: boolean;
  verification_level?: string;
  actual_cost_usd?: number;
  theoretical_cost_usd?: number;
  cost_metrics?: unknown;
  [key: string]: unknown;
}

interface StreamOutcome {
  status: 'complete' | 'error';
  result: TerminalResult | null;
  message?: string;
  errorStatus?: number;
}

/**
 * POST the run and consume the NDJSON stream. Progress is written to stderr
 * (so --json keeps stdout clean); the terminal complete/error is returned.
 */
async function streamBenchmarkRun(opts: {
  base: string;
  token: string;
  body: Record<string, unknown>;
  verbose: boolean;
  log: (line: string) => void;
}): Promise<StreamOutcome> {
  const url = `${opts.base.replace(/\/$/, '')}/api/benchmarks/runs/stream`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      'X-Benchmark-Run-Stream': 'ndjson',
    },
    body: JSON.stringify(opts.body),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    return {
      status: 'error',
      result: null,
      message: `stream request failed ${response.status}: ${text.slice(0, 500)}`,
      errorStatus: response.status,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let outcome: StreamOutcome | null = null;

  const handleEvent = (event: Record<string, unknown>): void => {
    const type = typeof event.type === 'string' ? event.type : 'event';
    const message = typeof event.message === 'string' ? event.message : '';
    const elapsed = typeof event.elapsed_seconds === 'number' ? `${event.elapsed_seconds}s` : '';

    if (type === 'heartbeat') {
      if (opts.verbose) opts.log(chalk.dim(`  · still executing${elapsed ? ` (${elapsed})` : ''}`));
      return;
    }
    if (type === 'complete') {
      const result = (event.result && typeof event.result === 'object' ? event.result : event) as TerminalResult;
      outcome = { status: 'complete', result };
      opts.log(chalk.green(`✓ ${message || 'Benchmark result recorded.'}`));
      return;
    }
    if (type === 'error') {
      outcome = {
        status: 'error',
        result: null,
        message: message || 'Benchmark run failed',
        errorStatus: typeof event.status === 'number' ? event.status : undefined,
      };
      opts.log(chalk.red(`✗ ${message || 'Benchmark run failed'}`));
      return;
    }
    if (type === 'started') {
      opts.log(chalk.cyan(`▶ ${message || 'Gateway accepted the proof-backed benchmark request.'}`));
      return;
    }
    if (opts.verbose) {
      opts.log(chalk.dim(`  ${type}${message ? `: ${message}` : ''}${elapsed ? ` (${elapsed})` : ''}`));
    }
  };

  const drain = (chunk: string): void => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        handleEvent(JSON.parse(trimmed));
      } catch {
        if (opts.verbose) opts.log(chalk.dim(`  (unparsed) ${trimmed.slice(0, 200)}`));
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    drain(decoder.decode(value, { stream: true }));
  }
  if (buffer.trim()) {
    try {
      handleEvent(JSON.parse(buffer.trim()));
    } catch {
      /* ignore trailing partial */
    }
  }

  return outcome ?? { status: 'error', result: null, message: 'Stream ended without a terminal event' };
}

async function startCandidateIngest(opts: {
  base: string;
  token: string;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const url = `${opts.base.replace(/\/$/, '')}/api/benchmarks/candidates/ingest`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(opts.body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CliError(`Candidate ingest failed ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }
  return payload as Record<string, unknown>;
}

export function createBenchCommands(config: ConfigManager, store: CredentialStore): Command {
  const bench = new Command('bench').description('Run the rickydata benchmark system on a public GitHub issue');

  bench
    .command('run')
    .description('Run a proof-backed benchmark for a public repo issue (<owner/repo#issue>)')
    .argument('<issueRef>', 'Public issue reference, e.g. Textualize/rich#4038')
    .option('--config <id>', 'Benchmark config id', DEFAULT_CONFIG_ID)
    .option('--campaign <id>', 'Campaign id', DEFAULT_CAMPAIGN_ID)
    .option('--base <url>', 'Bench server base URL', DEFAULT_BENCH_BASE)
    .option('--token-file <path>', 'Pre-minted bearer token file (otherwise reuse stored auth)')
    .option('--profile <profile>', 'Config profile to use')
    .option('--json', 'Print the machine-readable final result to stdout')
    .option('--verbose', 'Print all stream events, including heartbeats')
    .action(async (issueRef: string, opts: {
      config: string;
      campaign: string;
      base: string;
      tokenFile?: string;
      profile?: string;
      json?: boolean;
      verbose?: boolean;
    }) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const base = (opts.base ?? DEFAULT_BENCH_BASE).replace(/\/$/, '');
      const asJson = Boolean(opts.json);
      // Keep stdout clean for --json; progress always goes to stderr.
      const log = (line: string): void => { process.stderr.write(`${line}\n`); };

      const { repo, issueNumber } = parseIssueRef(issueRef);
      const token = await resolveBearerToken(store, profile, opts.tokenFile);

      const body = buildBenchRunRequestBody({
        repo,
        issueNumber,
        config: opts.config,
        campaignId: opts.campaign,
      });

      log(chalk.dim(`Running ${chalk.bold(`${repo}#${issueNumber}`)} · config ${opts.config} · ${base}`));

      const outcome = await streamBenchmarkRun({ base, token, body, verbose: Boolean(opts.verbose), log });

      if (outcome.status === 'complete' && outcome.result) {
        const r = outcome.result;
        const runUrl = benchIssueUrl(base, repo, issueNumber);
        if (asJson) {
          process.stdout.write(`${JSON.stringify({
            repo,
            issue_number: issueNumber,
            config: opts.config,
            campaign_id: opts.campaign,
            run_id: r.run_id ?? null,
            success: r.success ?? null,
            proof_verified: r.proof_verified ?? null,
            verification_level: r.verification_level ?? null,
            actual_cost_usd: r.actual_cost_usd ?? null,
            theoretical_cost_usd: r.theoretical_cost_usd ?? null,
            url: runUrl,
          }, null, 2)}\n`);
        } else {
          console.log();
          console.log(chalk.bold('Benchmark run complete'));
          console.log(`  run_id:             ${chalk.cyan(r.run_id ?? '(unknown)')}`);
          console.log(`  success:            ${r.success ? chalk.green('true') : chalk.yellow(String(r.success ?? 'unknown'))}`);
          console.log(`  proof_verified:     ${r.proof_verified ? chalk.green('true') : chalk.yellow(String(r.proof_verified ?? 'pending'))}`);
          if (r.verification_level) console.log(`  verification_level: ${chalk.cyan(String(r.verification_level))}`);
          if (r.actual_cost_usd !== undefined) console.log(`  actual_cost_usd:    ${chalk.cyan(String(r.actual_cost_usd))} ${chalk.dim('(real incremental spend)')}`);
          if (r.theoretical_cost_usd !== undefined) console.log(`  theoretical_cost_usd: ${chalk.cyan(String(r.theoretical_cost_usd))} ${chalk.dim('(PAYG reference)')}`);
          console.log(`  ${chalk.dim(runUrl)}`);
        }
        return;
      }

      // Terminal error. If it looks like the fixture/task doesn't exist yet, kick
      // off candidate ingest and tell the user how to proceed.
      const message = outcome.message ?? 'Benchmark run failed';
      if (looksLikeMissingTask(message)) {
        log(chalk.yellow(`No runnable benchmark task for ${repo}#${issueNumber}. Starting candidate ingest…`));
        try {
          const job = await startCandidateIngest({
            base,
            token,
            body: buildCandidateIngestBody({ repo, issueNumber, campaignId: opts.campaign }),
          });
          const jobId = job.job_id ?? '(unknown)';
          const status = job.status ?? '(unknown)';
          if (asJson) {
            process.stdout.write(`${JSON.stringify({
              repo,
              issue_number: issueNumber,
              config: opts.config,
              campaign_id: opts.campaign,
              run_id: null,
              success: false,
              error: message,
              ingest_job_id: jobId,
              ingest_status: status,
              url: benchIssueUrl(base, repo, issueNumber),
            }, null, 2)}\n`);
          } else {
            console.log();
            console.log(chalk.bold('Candidate ingest started'));
            console.log(`  job_id:  ${chalk.cyan(String(jobId))}`);
            console.log(`  status:  ${chalk.cyan(String(status))}`);
            if (job.message) console.log(`  message: ${chalk.dim(String(job.message))}`);
            console.log();
            console.log(chalk.dim('Ingest resolves the fix commit, gold diff, and targeted tests for this issue.'));
            console.log(chalk.dim(`Once it completes, re-run: rickydata bench run ${repo}#${issueNumber}`));
            console.log(chalk.dim(`Track progress at: ${base}/ingest?repo=${encodeURIComponent(repo)}&issue=${issueNumber}`));
          }
          process.exitCode = 1;
          return;
        } catch (ingestErr) {
          throw new CliError(`${message}\nCandidate ingest also failed: ${ingestErr instanceof Error ? ingestErr.message : String(ingestErr)}`);
        }
      }

      throw new CliError(message, outcome.errorStatus && outcome.errorStatus >= 400 ? 1 : 1);
    });

  return bench;
}
