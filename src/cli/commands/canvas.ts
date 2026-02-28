import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { ConfigManager } from '../config/config-manager.js';
import { CredentialStore } from '../config/credential-store.js';
import { formatOutput, formatJson, formatKeyValue, type OutputFormat } from '../output/formatter.js';
import { CliError, fail } from '../errors.js';
import { AuthManager } from '../../auth.js';
import { CanvasClient } from '../../canvas/canvas-client.js';
import type {
  CanvasWorkflowJSON,
  CanvasWorkflowRequest,
  CanvasSSEEvent,
  CanvasRunState,
  GeoWorkflow,
} from '../../canvas/types.js';

function requireAuth(store: CredentialStore, profile: string): string {
  const cred = store.getToken(profile);
  if (!cred) {
    fail('Not authenticated. Run `rickydata auth login` first.');
  }
  return cred.token;
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

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return chalk.green(status);
    case 'failed': return chalk.red(status);
    case 'running': return chalk.blue(status);
    case 'awaiting_approval': return chalk.yellow(status);
    case 'pending': return chalk.dim(status);
    default: return status;
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function isFilePath(input: string): boolean {
  return input.endsWith('.json') || input.includes('/') || input.includes('\\');
}

function workflowJsonToRequest(wf: CanvasWorkflowJSON): CanvasWorkflowRequest {
  const nodes = wf.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    data: n.data,
  }));
  const connections = wf.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }));
  return { nodes, connections };
}

function printSSEEvent(event: CanvasSSEEvent, verbose: boolean): void {
  switch (event.type) {
    case 'run_started':
      console.log(chalk.blue(`  Run started: ${event.data.runId}`));
      break;
    case 'node_started':
      console.log(chalk.blue(`  [${event.data.nodeId}] ${event.data.nodeType} started`));
      break;
    case 'node_completed':
      console.log(
        chalk.green(`  [${event.data.nodeId}] ${event.data.nodeType} completed`) +
        (event.data.durationMs ? chalk.dim(` (${formatDuration(event.data.durationMs)})`) : '')
      );
      break;
    case 'node_failed':
      console.log(chalk.red(`  [${event.data.nodeId}] ${event.data.nodeType} failed: ${event.data.error}`));
      break;
    case 'node_log':
      if (verbose) {
        const prefix = event.data.nodeId ? `[${event.data.nodeId}]` : '[log]';
        console.log(chalk.dim(`  ${prefix} ${event.data.message}`));
      }
      break;
    case 'approval_required':
      console.log(chalk.yellow(`  Approval required: ${event.data.message} (${event.data.approvalId})`));
      break;
    case 'approval_resolved':
      console.log(chalk.cyan(`  Approval ${event.data.decision}: ${event.data.approvalId}`));
      break;
    case 'team_agent_event':
      if (verbose) {
        console.log(chalk.dim(`  [team:${event.data.agentName}] ${event.data.eventKind}: ${event.data.message ?? ''}`));
      }
      break;
    case 'run_completed':
      console.log(chalk.green.bold(`  Run completed: ${event.data.runId}`));
      break;
    case 'run_failed':
      console.log(chalk.red.bold(`  Run failed: ${event.data.error}`));
      break;
    case 'error':
      console.log(chalk.red(`  Error: ${event.data.message}`));
      break;
    case 'text':
      if (verbose) {
        const text = typeof event.data === 'string' ? event.data : event.data.delta ?? '';
        if (text) process.stdout.write(chalk.dim(text));
      }
      break;
  }
}

export function createCanvasCommands(config: ConfigManager, store: CredentialStore): Command {
  const canvas = new Command('canvas').description('Manage and execute canvas workflows');

  // ── canvas list ──────────────────────────────────────────────────────────

  canvas
    .command('list')
    .description('List saved canvas workflows')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const client = createCanvasClient(gatewayUrl, token);
        const workflows = await client.listWorkflows();

        if (format === 'json') {
          console.log(formatJson(workflows));
          return;
        }

        if (workflows.length === 0) {
          console.log(chalk.yellow('No saved workflows found.'));
          return;
        }

        const rows = workflows.map((w: GeoWorkflow) => ({
          name: w.name,
          nodeCount: String(w.nodeCount ?? '—'),
          updatedAt: w.updatedAt ?? w.createdAt ?? '—',
          entityId: w.entityId,
        }));

        console.log(
          formatOutput(rows, [
            { header: 'Name', key: 'name', width: 30 },
            { header: 'Nodes', key: 'nodeCount', width: 8 },
            { header: 'Updated', key: 'updatedAt', width: 25 },
            { header: 'Entity ID', key: 'entityId', width: 40 },
          ], format)
        );
        console.log(chalk.dim(`\n${workflows.length} workflow(s)`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── canvas execute <workflow-id-or-file> ─────────────────────────────────

  canvas
    .command('execute <workflow-id-or-file>')
    .description('Execute a canvas workflow by entity ID or local .json file')
    .option('--auto-approve', 'Auto-approve all approval gates', false)
    .option('--verbose', 'Show all SSE events including logs', false)
    .option('--json', 'Output final result as JSON', false)
    .option('--model <model>', 'Model override (haiku|sonnet|opus)')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (workflowIdOrFile: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        const client = createCanvasClient(gatewayUrl, token);
        let request: CanvasWorkflowRequest;

        if (isFilePath(workflowIdOrFile)) {
          // Load from local file
          const filePath = path.resolve(workflowIdOrFile);
          if (!fs.existsSync(filePath)) {
            fail(`File not found: ${filePath}`);
          }
          const raw = fs.readFileSync(filePath, 'utf-8');
          const wfJson = JSON.parse(raw) as CanvasWorkflowJSON;
          request = workflowJsonToRequest(wfJson);
          console.log(chalk.dim(`Loaded workflow from ${filePath}`));
        } else {
          // Load from Geo by entity ID
          const workflows = await client.listWorkflows();
          const wf = workflows.find((w: GeoWorkflow) => w.entityId === workflowIdOrFile);
          if (!wf) {
            fail(`Workflow not found: ${workflowIdOrFile}`);
          }
          const nodes = JSON.parse(wf.nodesJson);
          const edges = JSON.parse(wf.edgesJson);
          request = workflowJsonToRequest({
            version: 1,
            name: wf.name,
            exportedAt: new Date().toISOString(),
            nodes,
            edges,
          });
          console.log(chalk.dim(`Loaded workflow "${wf.name}" (${wf.nodeCount} nodes)`));
        }

        if (opts.autoApprove) {
          request.runtime = { ...request.runtime, autoApprove: true };
        }

        const startTime = Date.now();
        let runId = '';
        let nodeCount = 0;
        let finalStatus = 'unknown';

        console.log(chalk.bold('\nExecuting workflow...\n'));

        if (opts.json) {
          // JSON mode: collect and dump result
          const result = await client.executeWorkflowSync(request);
          console.log(formatJson(result));
          return;
        }

        // Stream mode: print events in real-time
        for await (const event of client.executeWorkflow(request)) {
          printSSEEvent(event, opts.verbose);

          if (event.type === 'run_started') {
            runId = event.data.runId;
          }
          if (event.type === 'node_completed' || event.type === 'node_failed') {
            nodeCount++;
          }
          if (event.type === 'run_completed') {
            finalStatus = 'completed';
          }
          if (event.type === 'run_failed') {
            finalStatus = 'failed';
          }

          // Handle interactive approval
          if (event.type === 'approval_required' && !opts.autoApprove) {
            const approved = await confirm(`  Approve "${event.data.message}"?`);
            const decision = approved ? 'approve' as const : 'reject' as const;
            await client.approveGate(event.data.runId, event.data.approvalId, decision);
            console.log(chalk.cyan(`  Gate ${decision}d.`));
          }
        }

        const duration = Date.now() - startTime;
        console.log(chalk.dim('\n─'.repeat(40)));
        console.log(chalk.bold('Summary'));
        if (runId) console.log(`  Run ID:    ${chalk.cyan(runId)}`);
        console.log(`  Status:    ${statusColor(finalStatus)}`);
        console.log(`  Nodes:     ${chalk.cyan(String(nodeCount))}`);
        console.log(`  Duration:  ${chalk.cyan(formatDuration(duration))}`);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── canvas runs ──────────────────────────────────────────────────────────

  canvas
    .command('runs')
    .description('List recent workflow execution runs')
    .option('--limit <n>', 'Max runs to show', '20')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;
      const limit = parseInt(opts.limit, 10);

      try {
        const client = createCanvasClient(gatewayUrl, token);
        const runs = await client.listRuns();
        const limited = runs.slice(0, limit);

        if (format === 'json') {
          console.log(formatJson(limited));
          return;
        }

        if (limited.length === 0) {
          console.log(chalk.yellow('No runs found.'));
          return;
        }

        const rows = limited.map((r: CanvasRunState) => {
          const created = r.createdAt ?? '';
          const updated = r.updatedAt ?? '';
          let duration = '—';
          if (created && updated) {
            const ms = new Date(updated).getTime() - new Date(created).getTime();
            if (ms > 0) duration = formatDuration(ms);
          }
          return {
            runId: r.runId.slice(0, 12) + '...',
            status: r.status,
            createdAt: created,
            duration,
          };
        });

        console.log(
          formatOutput(rows, [
            { header: 'Run ID', key: 'runId', width: 18 },
            { header: 'Status', key: 'status', width: 20 },
            { header: 'Created', key: 'createdAt', width: 25 },
            { header: 'Duration', key: 'duration', width: 12 },
          ], format)
        );
        console.log(chalk.dim(`\n${limited.length} run(s)`));
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── canvas run <run-id> ──────────────────────────────────────────────────

  canvas
    .command('run <run-id>')
    .description('Show details of a specific workflow run')
    .option('--format <format>', 'Output format (table|json)', 'table')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (runId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);
      const format = opts.format as OutputFormat;

      try {
        const client = createCanvasClient(gatewayUrl, token);
        const run = await client.getRun(runId);

        if (format === 'json') {
          console.log(formatJson(run));
          return;
        }

        console.log(`\n${chalk.bold('Run')} ${chalk.cyan(run.runId)}`);
        console.log(chalk.dim('─'.repeat(50)));
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

        // Approvals
        if (run.approvals.length > 0) {
          console.log(`\n${chalk.bold('Approvals')} (${run.approvals.length}):`);
          for (const a of run.approvals) {
            const statusStr = a.status === 'approved' ? chalk.green(a.status)
              : a.status === 'rejected' ? chalk.red(a.status)
              : chalk.yellow(a.status);
            console.log(`  ${chalk.dim(a.approvalId)}: ${statusStr} — ${a.message}`);
          }
        }

        // Logs
        if (run.logs.length > 0) {
          console.log(`\n${chalk.bold('Logs')} (${run.logs.length}):`);
          for (const log of run.logs.slice(-20)) {
            console.log(`  ${chalk.dim(log)}`);
          }
          if (run.logs.length > 20) {
            console.log(chalk.dim(`  ... and ${run.logs.length - 20} more`));
          }
        }
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── canvas import <file> ─────────────────────────────────────────────────

  canvas
    .command('import <file>')
    .description('Import a .canvas.json file and save to Geo')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (file: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        const filePath = path.resolve(file);
        if (!fs.existsSync(filePath)) {
          fail(`File not found: ${filePath}`);
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const wfJson = JSON.parse(raw) as CanvasWorkflowJSON;

        const client = createCanvasClient(gatewayUrl, token);
        const result = await client.saveWorkflow({
          name: wfJson.name,
          description: wfJson.description,
          nodes: wfJson.nodes,
          edges: wfJson.edges,
        });

        console.log(chalk.green(`Workflow imported successfully.`));
        console.log(`  Name:        ${chalk.cyan(wfJson.name)}`);
        console.log(`  Workflow ID: ${chalk.cyan(result.workflowId)}`);
        console.log(`  Nodes:       ${chalk.cyan(String(wfJson.nodes.length))}`);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  // ── canvas export <workflow-id> ──────────────────────────────────────────

  canvas
    .command('export <workflow-id>')
    .description('Export a saved workflow to a .canvas.json file')
    .option('--output <path>', 'Output file path')
    .option('--profile <profile>', 'Config profile to use')
    .option('--gateway <url>', 'Override agent gateway URL')
    .action(async (workflowId: string, opts) => {
      const profile = opts.profile ?? config.getActiveProfile();
      const gatewayUrl = (opts.gateway ?? config.getAgentGatewayUrl(profile)).replace(/\/$/, '');
      const token = requireAuth(store, profile);

      try {
        const client = createCanvasClient(gatewayUrl, token);
        const workflows = await client.listWorkflows();
        const wf = workflows.find((w: GeoWorkflow) => w.entityId === workflowId);
        if (!wf) {
          fail(`Workflow not found: ${workflowId}`);
        }

        const nodes = JSON.parse(wf.nodesJson);
        const edges = JSON.parse(wf.edgesJson);

        const exportData: CanvasWorkflowJSON = {
          version: 1,
          name: wf.name,
          description: wf.description,
          exportedAt: new Date().toISOString(),
          nodes,
          edges,
        };

        const safeName = wf.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const outputPath = opts.output
          ? path.resolve(opts.output)
          : path.resolve(`${safeName}.canvas.json`);

        fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
        console.log(chalk.green(`Workflow exported.`));
        console.log(`  File: ${chalk.cyan(outputPath)}`);
        console.log(`  Name: ${chalk.cyan(wf.name)}`);
        console.log(`  Nodes: ${chalk.cyan(String(nodes.length))}`);
      } catch (err) {
        throw new CliError(err instanceof Error ? err.message : String(err));
      }
    });

  return canvas;
}
