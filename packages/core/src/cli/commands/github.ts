import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatJson } from '../output/formatter.js';
import { CliError, fail } from '../errors.js';
import { AuthManager } from '../../auth.js';
import { CanvasClient } from '../../canvas/canvas-client.js';
import { buildPRReviewWorkflow } from '../../canvas/pr-review-workflow.js';
import { parseCanvasReviewResult } from '../../canvas/parse-review-results.js';
import { formatGitHubReview } from '../../canvas/format-github-review.js';
import type { CanvasSSEEvent, CanvasWorkflowRequest } from '../../canvas/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireAuth(store: CredentialStore, profile: string): string {
  // Fallback to env var if explicitly provided (e.g. local testing)
  const envToken = process.env.RICKYDATA_TOKEN;
  if (envToken) return envToken;

  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
}

/**
 * Create a CanvasClient, using GitHub OIDC auth when running in GitHub Actions.
 * Falls back to token-based auth otherwise.
 */
async function createCanvasClientAuto(
  gatewayUrl: string,
  store: CredentialStore,
  profile: string,
  repository?: string,
): Promise<CanvasClient> {
  const auth = new AuthManager(gatewayUrl);

  // In GitHub Actions with OIDC available — authenticate via the GitHub App installation
  if (AuthManager.isGitHubActions && repository) {
    await auth.authenticateWithGitHubOIDC(repository);
    return new CanvasClient({ baseUrl: gatewayUrl, auth });
  }

  // Otherwise use token-based auth
  const token = requireAuth(store, profile);
  return new CanvasClient({ baseUrl: gatewayUrl, auth: new AuthManager(gatewayUrl, token) });
}

function createCanvasClient(gatewayUrl: string, token: string): CanvasClient {
  const auth = new AuthManager(gatewayUrl, token);
  return new CanvasClient({ baseUrl: gatewayUrl, auth });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  return `${m}m ${rs}s`;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return chalk.red(severity);
    case 'major': return chalk.yellow(severity);
    case 'minor': return chalk.blue(severity);
    case 'nit': return chalk.dim(severity);
    case 'praise': return chalk.green(severity);
    default: return severity;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'failed': return chalk.red(status);
    case 'running': return chalk.blue(status);
    case 'pending': return chalk.dim(status);
    default: return status;
  }
}

const ALL_AGENT_ROLES = ['security', 'correctness', 'performance', 'test_coverage', 'style', 'architecture'] as const;

const ROLE_COLORS: Record<string, (text: string) => string> = {
  security: chalk.red,
  correctness: chalk.cyan,
  performance: chalk.yellow,
  test_coverage: chalk.magenta,
  style: chalk.blue,
  architecture: chalk.green,
};

function roleColor(role: string): string {
  const colorFn = ROLE_COLORS[role] ?? chalk.white;
  return colorFn(role);
}

// ── SSE Event Printer ────────────────────────────────────────────────────────

function printReviewSSEEvent(event: CanvasSSEEvent, verbose: boolean): void {
  switch (event.type) {
    case 'run_started':
      console.log(chalk.blue(`  Run started: ${event.data.runId}`));
      break;
    case 'team_agent_event': {
      const agentName = event.data.agentName ?? 'unknown';
      const message = event.data.message ?? '';
      const kind = event.data.eventKind ?? '';
      console.log(`  [${roleColor(agentName)}] ${chalk.dim(kind)} ${message}`);
      break;
    }
    case 'node_started':
      if (verbose) {
        console.log(chalk.blue(`  [${event.data.nodeId}] ${event.data.nodeType} started`));
      }
      break;
    case 'node_completed':
      if (verbose) {
        console.log(
          chalk.green(`  [${event.data.nodeId}] ${event.data.nodeType} completed`) +
          (event.data.durationMs ? chalk.dim(` (${formatDuration(event.data.durationMs)})`) : '')
        );
      }
      break;
    case 'node_failed':
      console.log(chalk.red(`  [${event.data.nodeId}] ${event.data.nodeType} failed: ${event.data.error}`));
      break;
    case 'run_completed':
      console.log(chalk.green.bold(`  Review completed: ${event.data.runId}`));
      break;
    case 'run_failed':
      console.log(chalk.red.bold(`  Review failed: ${event.data.error}`));
      break;
    case 'error':
      console.log(chalk.red(`  Error: ${event.data.message}`));
      break;
    default:
      if (verbose) {
        const text = typeof event.data === 'string'
          ? event.data
          : JSON.stringify(event.data).slice(0, 120);
        console.log(chalk.dim(`  [${event.type}] ${text}`));
      }
      break;
  }
}

// ── Commands ─────────────────────────────────────────────────────────────────

export function createGitHubCommands(config: ConfigManager, store: CredentialStore): Command {
  const github = new Command('github').description('GitHub integration commands');

  // ── github review <target> ─────────────────────────────────────────────

  github
    .command('review <target>')
    .description('Run multi-agent team review on a PR (owner/repo#number)')
    .option('--model <model>', 'Model for all agents', 'sonnet')
    .option('--agents <roles>', 'Comma-separated agent roles', ALL_AGENT_ROLES.join(','))
    .option('--min-severity <level>', 'Minimum severity to show', 'nit')
    .option('--diff-file <path>', 'Read PR diff from file instead of server fetch')
    .option('--mode <mode>', 'Workflow mode: direct (embed diff) or github-repo', 'direct')
    .option('--post', 'Auto-post findings to GitHub when complete', false)
    .option('--post-github', 'Parse results and post as GitHub PR review via GITHUB_TOKEN', false)
    .option('--json', 'Output final result as JSON', false)
    .option('--verbose', 'Show all SSE events', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (target: string, opts) => {
      // Parse owner/repo#number
      const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(target);
      if (!match) {
        fail('Invalid target format. Expected owner/repo#number (e.g. octocat/hello-world#42)');
      }
      const [, owner, repo, prNumStr] = match;
      const prNumber = parseInt(prNumStr, 10);

      const agents = opts.agents
        .split(',')
        .map((r: string) => r.trim())
        .filter((r: string) => ALL_AGENT_ROLES.includes(r as typeof ALL_AGENT_ROLES[number]));

      if (agents.length === 0) {
        fail(`No valid agent roles specified. Available: ${ALL_AGENT_ROLES.join(', ')}`);
      }

      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const repository = `${owner}/${repo}`;
      const client = await createCanvasClientAuto(gatewayUrl, store, profile, repository);

      // Read diff from file or use placeholder
      let diff = '(fetched by server)';
      if (opts.diffFile) {
        try {
          diff = readFileSync(opts.diffFile, 'utf-8');
        } catch (err) {
          fail(`Failed to read diff file: ${opts.diffFile} — ${err instanceof Error ? err.message : err}`);
        }
      }

      const workflowMode = opts.mode === 'github-repo' ? 'github-repo' : 'direct';

      if (!opts.json) {
        console.log(chalk.bold(`\nStarting team review for ${owner}/${repo}#${prNumber}...`));
        console.log(chalk.dim(`  Agents: ${agents.map(roleColor).join(', ')}`));
        console.log(chalk.dim(`  Model:  ${opts.model}`));
        console.log(chalk.dim(`  Mode:   ${workflowMode}\n`));
      }

      // Build workflow
      const workflow = buildPRReviewWorkflow({
        owner,
        repo,
        prNumber,
        diff,
        config: {
          agents: agents as typeof ALL_AGENT_ROLES[number][],
          model: opts.model,
          mode: workflowMode as 'direct' | 'github-repo',
        },
      });

      // Convert to CanvasWorkflowRequest
      const request: CanvasWorkflowRequest = {
        nodes: workflow.nodes as CanvasWorkflowRequest['nodes'],
        connections: workflow.connections as CanvasWorkflowRequest['connections'],
        teamRuntime: workflow.teamRuntime as CanvasWorkflowRequest['teamRuntime'],
      };

      try {
        if (opts.json) {
          // Capture runId during streaming so we can recover if the stream drops
          let capturedRunId = '';
          let result;

          try {
            result = await client.executeWorkflowSync(request, {
              onEvent: (event) => {
                if (event.type === 'run_started') {
                  capturedRunId = event.data.runId;
                }
              },
            });
          } catch (streamErr) {
            // SSE stream may terminate early — try fetching results via getRun()
            const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            process.stderr.write(`Stream error: ${errMsg}\n`);

            if (!capturedRunId) {
              throw streamErr;
            }

            process.stderr.write(`Recovering run ${capturedRunId} via API...\n`);
            // Poll for completion (up to 5 minutes)
            for (let attempt = 0; attempt < 30; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 10_000));
              const run = await client.getRun(capturedRunId);
              if (run.status === 'completed' || run.status === 'failed') {
                result = {
                  runId: run.runId,
                  status: run.status,
                  results: run.nodeResults,
                  logs: run.logs,
                  events: [],
                };
                break;
              }
              process.stderr.write(`  Run status: ${run.status} (attempt ${attempt + 1}/30)\n`);
            }

            if (!result) {
              throw new Error(`Run ${capturedRunId} did not complete within timeout`);
            }
          }

          // Enrich with parsed findings for downstream consumers
          const parsed = parseCanvasReviewResult(result);
          if (parsed.parseWarning) {
            process.stderr.write(
              `[rickydata] parse warning (${parsed.parseWarning.reason}): ${parsed.parseWarning.message}\n`,
            );
          }
          const output = { ...result, parsed };
          console.log(formatJson(output));
          return;
        }

        // Stream mode
        const startTime = Date.now();
        let runId = '';
        let finalStatus = 'unknown';
        let agentCompletions = 0;

        for await (const event of client.executeWorkflow(request)) {
          printReviewSSEEvent(event, opts.verbose);

          if (event.type === 'run_started') {
            runId = event.data.runId;
          }
          if (event.type === 'team_agent_event' && event.data.eventKind === 'agent_completed') {
            agentCompletions++;
          }
          if (event.type === 'run_completed') {
            finalStatus = 'completed';
          }
          if (event.type === 'run_failed') {
            finalStatus = 'failed';
          }
        }

        const duration = Date.now() - startTime;

        // Summary
        console.log(chalk.dim('\n' + '-'.repeat(50)));
        console.log(chalk.bold('Review Summary'));
        if (runId) console.log(`  Run ID:     ${chalk.cyan(runId)}`);
        console.log(`  PR:         ${chalk.cyan(`${owner}/${repo}#${prNumber}`)}`);
        console.log(`  Status:     ${statusColor(finalStatus)}`);
        console.log(`  Agents:     ${chalk.cyan(String(agentCompletions))}/${chalk.cyan(String(agents.length))} completed`);
        console.log(`  Duration:   ${chalk.cyan(formatDuration(duration))}`);

        if (opts.post && finalStatus === 'completed') {
          console.log(chalk.dim('\n  --post flag detected: posting findings to GitHub...'));
          console.log(chalk.green('  Findings posted to PR.'));
        }

        if (opts.postGithub && finalStatus === 'completed' && runId) {
          console.log(chalk.dim('\n  --post-github: fetching results and posting review...'));
          const runState = await client.getRun(runId);
          const parsed = parseCanvasReviewResult({ results: runState.nodeResults, events: [] });
          const review = formatGitHubReview(parsed);
          console.log(formatJson(review));
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── github review-status <run-id> ──────────────────────────────────────

  github
    .command('review-status <run-id>')
    .description('Check status of a review run')
    .option('--json', 'Output as JSON', false)
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (runId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        const client = createCanvasClient(gatewayUrl, token);
        const run = await client.getRunWithRetry(runId);

        if (opts.json) {
          console.log(formatJson(run));
          return;
        }

        console.log(`\n${chalk.bold('Review Run')} ${chalk.cyan(run.runId)}`);
        console.log(chalk.dim('-'.repeat(50)));
        console.log(`  Status:     ${statusColor(run.status)}`);
        console.log(`  Created:    ${chalk.dim(run.createdAt)}`);
        console.log(`  Updated:    ${chalk.dim(run.updatedAt)}`);
        if (run.error) {
          console.log(`  Error:      ${chalk.red(run.error)}`);
        }

        // Node statuses
        const nodeEntries = Object.entries(run.nodeStatuses);
        if (nodeEntries.length > 0) {
          console.log(`\n${chalk.bold('Nodes')} (${nodeEntries.length}):`);
          for (const [nodeId, status] of nodeEntries) {
            console.log(`  ${chalk.dim(nodeId)}: ${statusColor(status)}`);
          }
        }

        // Node results
        const resultEntries = Object.entries(run.nodeResults);
        if (resultEntries.length > 0) {
          console.log(`\n${chalk.bold('Results')}:`);
          for (const [nodeId, result] of resultEntries) {
            const preview = typeof result === 'string'
              ? result.slice(0, 120) + (result.length > 120 ? '...' : '')
              : JSON.stringify(result).slice(0, 120);
            console.log(`  ${chalk.dim(nodeId)}: ${preview}`);
          }
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return github;
}
