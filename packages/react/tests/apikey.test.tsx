import { describe, it, expect, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { createMockClient, renderHookWithProvider } from './test-utils.js';
import { useApiKeyStatus, useSetApiKey } from '../src/hooks/apikey.js';

describe('useApiKeyStatus', () => {
  it('returns configured status', async () => {
    const mockClient = createMockClient();
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: true });

    const { result } = renderHookWithProvider(
      () => useApiKeyStatus(),
      mockClient,
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ configured: true });
    expect(mockClient.getApiKeyStatus).toHaveBeenCalled();
  });

  it('returns unconfigured status', async () => {
    const mockClient = createMockClient();
    mockClient.getApiKeyStatus.mockResolvedValue({ configured: false });

    const { result } = renderHookWithProvider(
      () => useApiKeyStatus(),
      mockClient,
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ configured: false });
  });
});

describe('useSetApiKey', () => {
  it('calls client setApiKey', async () => {
    const mockClient = createMockClient();

    const { result } = renderHookWithProvider(
      () => useSetApiKey(),
      mockClient,
    );

    await act(async () => {
      await result.current.mutateAsync('sk-test-key-123');
    });

    expect(mockClient.setApiKey).toHaveBeenCalledWith('sk-test-key-123');
  });
});
