/**
 * Canvas Workflow MCP Tool Definitions
 *
 * Defines MCP tools that wrap the CanvasClient for canvas workflow operations.
 * Each tool has a name, description, JSON Schema for input, and a handler function.
 */

import type { CanvasClient } from '../canvas/canvas-client.js';
import type {
  CanvasWorkflowJSON,
  CanvasRuntimeMode,
  CanvasSSEEvent,
} from '../canvas/types.js';

// ── Tool Result Helpers ────────────────────────────────────────────────────

export interface MCPToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function ok(data: unknown): MCPToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function err(error: unknown): MCPToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ── Tool Definition Type ───────────────────────────────────────────────────

export interface CanvasMCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (args: Record<string, unknown>, client: CanvasClient) => Promise<MCPToolResponse>;
}

// ── Tool Definitions ───────────────────────────────────────────────────────

export function createCanvasTools(): CanvasMCPTool[] {
  return [
    // ── canvas_list_workflows ────────────────────────────────────────
    {
      name: 'canvas_list_workflows',
      description:
        'List saved canvas workflows for the authenticated wallet. Returns workflow summaries with IDs, names, and metadata.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async (_args, client) => {
        try {
          const workflows = await client.listWorkflows();
          const summaries = workflows.map((w) => ({
            entityId: w.entityId,
            name: w.name,
            description: w.description ?? null,
            nodeCount: w.nodeCount,
            version: w.version,
            updatedAt: w.updatedAt ?? w.createdAt ?? null,
          }));
          return ok({ workflows: summaries, count: summaries.length });
        } catch (error) {
          return err(error);
        }
      },
    },

    // ── canvas_get_workflow ──────────────────────────────────────────
    {
      name: 'canvas_get_workflow',
      description:
        'Get full details of a specific canvas workflow by its entity ID. Returns the complete workflow JSON including nodes, edges, and metadata.',
      inputSchema: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'The workflow entity ID (from canvas_list_workflows)',
          },
        },
        required: ['workflowId'],
      },
      handler: async (args, client) => {
        try {
          const workflowId = args.workflowId as string;
          const workflows = await client.listWorkflows();
          const workflow = workflows.find((w) => w.entityId === workflowId);

          if (!workflow) {
            return err(`Workflow not found: ${workflowId}`);
          }

          // Parse stored JSON
          let nodes: unknown[] = [];
          let edges: unknown[] = [];
          try {
            nodes = JSON.parse(workflow.nodesJson);
          } catch { /* empty */ }
          try {
            edges = JSON.parse(workflow.edgesJson);
          } catch { /* empty */ }

          return ok({
            entityId: workflow.entityId,
            name: workflow.name,
            description: workflow.description ?? null,
            nodeCount: workflow.nodeCount,
            version: workflow.version,
            nodes,
            edges,
            createdAt: workflow.createdAt ?? null,
            updatedAt: workflow.updatedAt ?? null,
          });
        } catch (error) {
          return err(error);
        }
      },
    },

    // ── canvas_execute_workflow ──────────────────────────────────────
    {
      name: 'canvas_execute_workflow',
      description:
        'Execute a saved canvas workflow by its entity ID. Collects all SSE execution events and returns the complete result including run ID, status, logs, and node results.',
      inputSchema: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description: 'The workflow entity ID to execute',
          },
          autoApprove: {
            type: 'boolean',
            description: 'Auto-approve approval gates (default: false)',
          },
          runtimeMode: {
            type: 'string',
            enum: ['read_only', 'write_candidate'],
            description: 'Runtime mode (default: read_only)',
          },
          allowAgentFallback: {
            type: 'boolean',
            description: 'Allow agent fallback on failures (default: false)',
          },
        },
        required: ['workflowId'],
      },
      handler: async (args, client) => {
        try {
          const workflowId = args.workflowId as string;

          // Fetch workflow details
          const workflows = await client.listWorkflows();
          const workflow = workflows.find((w) => w.entityId === workflowId);
          if (!workflow) {
            return err(`Workflow not found: ${workflowId}`);
          }

          let nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = [];
          let connections: Array<{ source: string; target: string }> = [];
          try {
            const rawNodes = JSON.parse(workflow.nodesJson) as Array<Record<string, unknown>>;
            nodes = rawNodes.map((n) => ({
              id: n.id as string,
              type: n.type as string,
              data: (n.data ?? {}) as Record<string, unknown>,
            }));
          } catch { /* empty */ }
          try {
            const rawEdges = JSON.parse(workflow.edgesJson) as Array<Record<string, unknown>>;
            connections = rawEdges.map((e) => ({
              source: e.source as string,
              target: e.target as string,
            }));
          } catch { /* empty */ }

          const logs: string[] = [];
          const result = await client.executeWorkflowSync(
            {
              nodes,
              connections,
              runtime: {
                mode: (args.runtimeMode as CanvasRuntimeMode) ?? undefined,
                allowAgentFallback: (args.allowAgentFallback as boolean) ?? undefined,
                autoApprove: (args.autoApprove as boolean) ?? undefined,
              },
            },
            {
              onEvent: (event: CanvasSSEEvent) => {
                if (event.type === 'node_log') {
                  logs.push(event.data.message);
                }
              },
            },
          );

          return ok({
            runId: result.runId,
            status: result.status,
            logs: result.logs,
            results: result.results,
            eventCount: result.events.length,
          });
        } catch (error) {
          return err(error);
        }
      },
    },

    // ── canvas_execute_workflow_from_json ────────────────────────────
    {
      name: 'canvas_execute_workflow_from_json',
      description:
        'Execute a canvas workflow from inline JSON definition. Provide nodes and edges directly without saving to Geo first. Returns the complete execution result.',
      inputSchema: {
        type: 'object',
        properties: {
          workflow: {
            type: 'object',
            description: 'Workflow JSON with nodes and edges arrays',
            properties: {
              name: { type: 'string', description: 'Workflow name' },
              nodes: {
                type: 'array',
                description: 'Array of node definitions with id, type, position, and data',
              },
              edges: {
                type: 'array',
                description: 'Array of edge definitions with source and target node IDs',
              },
            },
            required: ['nodes', 'edges'],
          },
          autoApprove: {
            type: 'boolean',
            description: 'Auto-approve approval gates (default: false)',
          },
          runtimeMode: {
            type: 'string',
            enum: ['read_only', 'write_candidate'],
            description: 'Runtime mode (default: read_only)',
          },
          allowAgentFallback: {
            type: 'boolean',
            description: 'Allow agent fallback on failures (default: false)',
          },
        },
        required: ['workflow'],
      },
      handler: async (args, client) => {
        try {
          const wf = args.workflow as CanvasWorkflowJSON;
          if (!wf.nodes || !Array.isArray(wf.nodes)) {
            return err('workflow.nodes must be an array');
          }
          if (!wf.edges && !Array.isArray(wf.edges)) {
            return err('workflow.edges must be an array');
          }

          const nodes = wf.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            data: (n.data ?? {}) as Record<string, unknown>,
          }));

          const connections = (wf.edges ?? []).map((e) => ({
            source: e.source,
            target: e.target,
          }));

          const result = await client.executeWorkflowSync(
            {
              nodes,
              connections,
              runtime: {
                mode: (args.runtimeMode as CanvasRuntimeMode) ?? undefined,
                allowAgentFallback: (args.allowAgentFallback as boolean) ?? undefined,
                autoApprove: (args.autoApprove as boolean) ?? undefined,
              },
            },
          );

          return ok({
            runId: result.runId,
            status: result.status,
            logs: result.logs,
            results: result.results,
            eventCount: result.events.length,
          });
        } catch (error) {
          return err(error);
        }
      },
    },

    // ── canvas_list_runs ────────────────────────────────────────────
    {
      name: 'canvas_list_runs',
      description:
        'List recent canvas workflow execution runs for the authenticated wallet. Returns run summaries with IDs, statuses, and timestamps.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of runs to return (default: 20)',
          },
        },
      },
      handler: async (args, client) => {
        try {
          const runs = await client.listRuns();
          const limit = (args.limit as number) ?? 20;
          const limited = runs.slice(0, limit);

          const summaries = limited.map((r) => ({
            runId: r.runId,
            status: r.status,
            nodeCount: Object.keys(r.nodeStatuses ?? {}).length,
            logCount: (r.logs ?? []).length,
            error: r.error ?? null,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }));

          return ok({ runs: summaries, count: summaries.length });
        } catch (error) {
          return err(error);
        }
      },
    },

    // ── canvas_get_run ──────────────────────────────────────────────
    {
      name: 'canvas_get_run',
      description:
        'Get full details of a specific canvas workflow run by its run ID. Returns node statuses, results, approvals, and logs.',
      inputSchema: {
        type: 'object',
        properties: {
          runId: {
            type: 'string',
            description: 'The run ID to look up',
          },
        },
        required: ['runId'],
      },
      handler: async (args, client) => {
        try {
          const runId = args.runId as string;
          const run = await client.getRun(runId);
          return ok({
            runId: run.runId,
            status: run.status,
            nodeStatuses: run.nodeStatuses,
            nodeResults: run.nodeResults,
            approvals: run.approvals,
            logs: run.logs,
            error: run.error ?? null,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
          });
        } catch (error) {
          return err(error);
        }
      },
    },

    // ── canvas_save_workflow ────────────────────────────────────────
    {
      name: 'canvas_save_workflow',
      description:
        'Save a new canvas workflow to Geo storage. Provide a name, optional description, and the workflow nodes and edges.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name for the workflow',
          },
          description: {
            type: 'string',
            description: 'Optional description of the workflow',
          },
          nodes: {
            type: 'array',
            description: 'Array of node definitions (id, type, position, data)',
          },
          edges: {
            type: 'array',
            description: 'Array of edge definitions (source, target)',
          },
        },
        required: ['name', 'nodes', 'edges'],
      },
      handler: async (args, client) => {
        try {
          const name = args.name as string;
          const description = args.description as string | undefined;
          const nodes = args.nodes as unknown[];
          const edges = args.edges as unknown[];

          const result = await client.saveWorkflow({
            name,
            description,
            nodes,
            edges,
          });

          return ok({
            workflowId: result.workflowId,
            name,
            message: `Workflow "${name}" saved successfully`,
          });
        } catch (error) {
          return err(error);
        }
      },
    },
  ];
}
