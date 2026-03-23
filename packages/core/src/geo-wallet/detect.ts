import type { PendingGeoTransaction } from './types.js';

/**
 * Geo write tools that can return a pending-signature response in APPROVAL mode.
 */
const GEO_WRITE_TOOLS = new Set([
  'publish_edit',
  'propose_dao_edit',
  'setup_space',
  'vote_on_proposal',
  'propose_accept_editor',
  'propose_remove_editor',
  'propose_accept_subspace',
  'propose_remove_subspace',
  'upsert_workspace_entity',
  'delete_workspace_entity',
  'upsert_canvas_workflow',
  'submit_signed_transaction',
]);

/**
 * Detect whether a tool result contains a Geo transaction signing request.
 *
 * In APPROVAL mode, geo_mcp_server write tools return:
 *   `{ status: 'pending_signature', id, to, data, description, toolName, metadata }`
 *
 * Returns the PendingGeoTransaction if found, null otherwise.
 */
export function detectGeoTransactionRequest(
  toolName: string,
  toolResult: string,
): PendingGeoTransaction | null {
  if (!toolResult) return null;

  // Strip any server-specific prefix (e.g. "rickycambrian-geo-mcp-server__publish_edit")
  const bareToolName = toolName.includes('__')
    ? toolName.slice(toolName.lastIndexOf('__') + 2)
    : toolName;

  if (!GEO_WRITE_TOOLS.has(bareToolName)) return null;

  // Strip x402 payment receipt if appended
  const cleanResult = toolResult.split('\n{"_payment"')[0].trim();

  try {
    const parsed = JSON.parse(cleanResult);
    const tx = extractPendingTx(parsed);
    if (tx) return tx;
  } catch {
    // Not JSON at the top level — try MCP content array wrapper
  }

  // Handle MCP content array format: { content: [{ type: 'text', text: '...' }] }
  try {
    const parsed = JSON.parse(cleanResult);
    if (Array.isArray(parsed.content)) {
      for (const item of parsed.content) {
        if (item.type === 'text' && typeof item.text === 'string') {
          try {
            const inner = JSON.parse(item.text.split('\n{"_payment"')[0].trim());
            const tx = extractPendingTx(inner);
            if (tx) return tx;
          } catch {
            // inner text wasn't JSON, skip
          }
        }
      }
    }
  } catch {
    // not parseable at all
  }

  return null;
}

/** Extract PendingGeoTransaction fields from a parsed JSON object. */
function extractPendingTx(obj: Record<string, unknown>): PendingGeoTransaction | null {
  if (obj.status !== 'pending_signature') return null;
  if (typeof obj.id !== 'string' || typeof obj.to !== 'string' || typeof obj.data !== 'string') {
    return null;
  }

  return {
    id: obj.id,
    to: obj.to,
    data: obj.data,
    value: typeof obj.value === 'string' ? obj.value : undefined,
    description: typeof obj.description === 'string' ? obj.description : 'Geo transaction',
    toolName: typeof obj.toolName === 'string' ? obj.toolName : 'unknown',
    metadata: typeof obj.metadata === 'object' && obj.metadata !== null
      ? obj.metadata as Record<string, unknown>
      : undefined,
  };
}
