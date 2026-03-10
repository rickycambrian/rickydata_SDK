import { useState, useEffect, useCallback } from 'react';
import { useRickyData } from '../providers/RickyDataProvider.js';
import type { SecretSection } from '../types.js';

interface UseSecretsOptions {
  agentId: string;
  mcpServers?: string[];
}

interface UseSecretsResult {
  sections: SecretSection[];
  loading: boolean;
  allConfigured: boolean;
  refresh: () => void;
}

/**
 * Discovers all missing secrets (API key + agent + MCP) for an agent.
 * Returns sections with save callbacks for each.
 */
export function useSecrets({ agentId, mcpServers = [] }: UseSecretsOptions): UseSecretsResult {
  const client = useRickyData();
  const [sections, setSections] = useState<SecretSection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequirements = useCallback(async () => {
    setLoading(true);
    const result: SecretSection[] = [];

    try {
      // Check Anthropic API key
      const { configured } = await client.getApiKeyStatus();
      if (!configured) {
        result.push({
          id: 'anthropic',
          label: 'Anthropic API Key',
          keys: ['ANTHROPIC_API_KEY'],
          configuredKeys: [],
          save: async (secrets) => {
            const key = secrets['ANTHROPIC_API_KEY'];
            if (key) await client.setApiKey(key);
          },
        });
      }
    } catch { /* skip */ }

    // Check agent-level secrets
    try {
      const status = await client.getAgentSecretStatus(agentId);
      if (status.missingRequired.length > 0) {
        result.push({
          id: `agent-${agentId}`,
          label: 'Agent Secrets',
          keys: status.missingRequired,
          configuredKeys: status.configuredSecrets,
          save: async (secrets) => {
            await client.storeAgentSecrets(agentId, secrets);
          },
        });
      }
    } catch { /* skip */ }

    // Check MCP server secrets
    if (mcpServers.length > 0) {
      try {
        const reqs = await client.getMcpRequirements(agentId);
        for (const server of reqs.servers) {
          const missing = server.missing || server.required.filter(k => !server.configured?.includes(k));
          if (missing.length > 0) {
            result.push({
              id: `mcp-${server.serverId}`,
              label: `MCP: ${server.name || server.serverId}`,
              keys: missing,
              configuredKeys: server.configured || [],
              save: async (secrets) => {
                await client.storeMcpSecrets(server.serverId, secrets);
              },
            });
          }
        }
      } catch { /* skip */ }
    }

    setSections(result);
    setLoading(false);
  }, [client, agentId, mcpServers.join(',')]);

  useEffect(() => {
    fetchRequirements();
  }, [fetchRequirements]);

  return {
    sections,
    loading,
    allConfigured: !loading && sections.length === 0,
    refresh: fetchRequirements,
  };
}
