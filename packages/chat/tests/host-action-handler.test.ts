import { describe, expect, it, vi } from 'vitest';
import { createHostActionHandler } from '../src/hooks/useHostCopilotEngine.js';
import type { AgentActionRequest } from '../src/types/host.js';

const proposal: AgentActionRequest = {
  proposalId: 'proposal-1',
  actionType: 'insert_cell',
  description: 'Insert a KQL cell',
  params: {
    language: 'kql',
    code: 'MATCH (p:ResearchPaper) RETURN p.title LIMIT 5',
  },
  status: 'pending',
};

describe('createHostActionHandler', () => {
  it('confirms completed host actions and forwards revalidation keys', async () => {
    const executeAction = vi.fn(async () => ({
      proposalId: proposal.proposalId,
      status: 'completed' as const,
      revalidateKeys: ['cells', 'execution'],
    }));

    const handler = createHostActionHandler({
      getContextSnapshot: () => ({ route: '/notebook', view: 'notebook' }),
      executeAction,
    });

    await expect(handler(proposal)).resolves.toEqual({
      confirmed: true,
      revalidateKeys: ['cells', 'execution'],
    });
    expect(executeAction).toHaveBeenCalledWith(proposal);
  });

  it('throws when the host adapter does not implement confirmed actions', async () => {
    const handler = createHostActionHandler({
      getContextSnapshot: () => ({ route: '/notebook', view: 'notebook' }),
    });

    await expect(handler(proposal)).rejects.toThrow('Host adapter does not support confirmed actions');
  });

  it('throws when the host action does not complete successfully', async () => {
    const handler = createHostActionHandler({
      getContextSnapshot: () => ({ route: '/notebook', view: 'notebook' }),
      executeAction: async () => ({
        proposalId: proposal.proposalId,
        status: 'failed',
        message: 'The selected cell no longer exists',
      }),
    });

    await expect(handler(proposal)).rejects.toThrow('The selected cell no longer exists');
  });
});
