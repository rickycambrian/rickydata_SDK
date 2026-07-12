import { createHash } from 'node:crypto';

/**
 * Session-link helpers (design D6: star topology).
 *
 * Three Claude-session node families exist in the graph today with no
 * connecting edges even though they share the same Claude session UUID:
 * schema-v3 `ClaudeCodeSession` (SDK trace builders), `RickydataChatSession`
 * (rickydata_home bridge) and `RickydataAgentSession` (rickydata_git).
 *
 * Rather than teaching every writer how to derive every other family's ID,
 * each writer emits a single deterministic `HarnessSessionKey` merge node
 * keyed on (walletLower, claudeSessionUuid) plus a `SAME_SESSION` edge from
 * its own session node. Because all writers derive the HarnessSessionKey ID
 * from the SAME shared execution namespace + recipe, the merge node converges
 * across families, forming a star that ties the session together.
 */

// Shared execution namespace — identical string/recipe used by every trace
// builder (see EXECUTION_KG_NAMESPACE in claude-code-hook-trace.ts,
// codex-hook-trace.ts, hermes-hook-trace.ts, agent-chat-trace.ts). Nodes keyed
// under this namespace converge across writers, which is exactly what the
// HarnessSessionKey merge node relies on.
const EXECUTION_KG_NAMESPACE = uuidV5('rickydata-execution-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
const TRACE_SCHEMA_VERSION = 3;

export const HARNESS_SESSION_KEY_LABEL = 'HarnessSessionKey';
export const SAME_SESSION_EDGE_TYPE = 'SAME_SESSION';

export interface SessionLinkInput {
  walletAddress: string;
  claudeSessionId: string;
}

export interface BuildSessionLinkInput extends SessionLinkInput {
  fromNodeId: string;
  fromLabel: string;
}

function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error('Invalid UUID namespace');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name)])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicExecutionId(kind: string, parts: Array<string | number>): string {
  return uuidV5(`${kind}:${parts.map((p) => String(p)).join(':')}`, EXECUTION_KG_NAMESPACE);
}

function value(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return { Null: null };
  if (typeof input === 'boolean') return { Boolean: input };
  if (typeof input === 'number') return Number.isInteger(input) ? { Integer: input } : { Float: input };
  return { String: String(input) };
}

/**
 * Deterministic UUIDv5 node ID for the HarnessSessionKey merge node.
 *
 * Keyed on (walletLower, claudeSessionId) under the shared execution
 * namespace so that every writer — regardless of session-node family —
 * produces byte-identical IDs and their merge nodes converge.
 */
export function sessionLinkNodeId({ walletAddress, claudeSessionId }: SessionLinkInput): string {
  const wallet = walletAddress.toLowerCase();
  return deterministicExecutionId(HARNESS_SESSION_KEY_LABEL, [wallet, claudeSessionId]);
}

/**
 * Operations that link a writer's own session node into the shared session star:
 *   a. a `HarnessSessionKey` merge node keyed on (walletLower, claudeSessionId);
 *   b. a `SAME_SESSION` edge from `fromNodeId` (label `fromLabel`) to that node.
 *
 * The merge node deliberately carries NO `source` property: it is a converging
 * node written by many families, and in the encrypted KFDB an explicit `source`
 * (especially a null one) is treated as a private value that would stop the node
 * from converging. This mirrors the other shared execution nodes (WalletTenant,
 * Agent, ExecutionEngine, ...), which likewise omit `source`.
 */
export function buildSessionLinkOperations({
  walletAddress,
  claudeSessionId,
  fromNodeId,
  fromLabel,
}: BuildSessionLinkInput): Array<Record<string, unknown>> {
  const wallet = walletAddress.toLowerCase();
  const harnessNodeId = sessionLinkNodeId({ walletAddress, claudeSessionId });
  return [
    {
      operation: 'create_node',
      id: harnessNodeId,
      label: HARNESS_SESSION_KEY_LABEL,
      mode: 'merge',
      properties: {
        wallet_address: value(wallet),
        claude_session_id: value(claudeSessionId),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicExecutionId(SAME_SESSION_EDGE_TYPE, [fromNodeId, harnessNodeId]),
      from: fromNodeId,
      to: harnessNodeId,
      edge_type: SAME_SESSION_EDGE_TYPE,
      properties: { from_label: value(fromLabel) },
    },
  ];
}
