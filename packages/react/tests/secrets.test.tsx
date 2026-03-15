import { describe, it, expect, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { createMockClient, renderHookWithProvider } from './test-utils.js';
import { useSecrets } from '../src/hooks/secrets.js';

describe('useSecrets', () => {
  it('discovers unconfigured API key', async () => {
    const mockClient = createMockClient();
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: false });

    const { result } = renderHookWithProvider(
      () => useSecrets({ agentId: 'agent-1' }),
      mockClient,
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.allConfigured).toBe(false);
    expect(result.current.sections).toHaveLength(1);
    expect(result.current.sections[0].id).toBe('anthropic');
    expect(result.current.sections[0].keys).toContain('ANTHROPIC_API_KEY');

    // Verify save callback works
    await act(async () => {
      await result.current.sections[0].save({ ANTHROPIC_API_KEY: 'sk-test' });
    });
    expect(mockClient.setApiKey).toHaveBeenCalledWith('sk-test');
  });

  it('allConfigured when everything is set', async () => {
    const mockClient = createMockClient();
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: true });
    mockClient.getAgentSecretStatus.mockResolvedValue({
      configuredSecrets: ['KEY_1'],
      missingRequired: [],
      ready: true,
    });

    const { result } = renderHookWithProvider(
      () => useSecrets({ agentId: 'agent-1' }),
      mockClient,
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.allConfigured).toBe(true);
    expect(result.current.sections).toHaveLength(0);
  });
});
