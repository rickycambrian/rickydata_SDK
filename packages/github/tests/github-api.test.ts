import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubApi } from '../src/services/github-api.js';
import { DEFAULT_GITHUB_REPO_SETTINGS, type GitHubRepoSettings } from '../src/types.js';

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockSSEFetch(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    text: () => Promise.resolve(''),
  });
}

describe('GitHubApi repo sessions', () => {
  let api: GitHubApi;
  const baseUrl = 'https://gateway.example.com';
  const token = 'test-token-123';

  beforeEach(() => {
    api = new GitHubApi({
      baseUrl,
      getToken: () => Promise.resolve(token),
    });
  });

  it('exports no-store, hooks-disabled defaults', () => {
    expect(DEFAULT_GITHUB_REPO_SETTINGS).toEqual({
      privacyMode: 'no_store_active_chat',
      hookPolicy: 'disabled',
      executionEngine: '',
      provider: '',
      folderScopes: [],
    });
  });

  it('gets repo settings', async () => {
    const settings: GitHubRepoSettings = {
      ...DEFAULT_GITHUB_REPO_SETTINGS,
      executionEngine: 'codex',
      provider: 'github',
      folderScopes: ['packages/github'],
    };
    globalThis.fetch = mockFetch(settings);

    const result = await api.getRepoSettings('owner', 'repo');

    expect(result).toEqual(settings);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${baseUrl}/github/repos/owner/repo/settings`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('updates repo settings with a PUT body', async () => {
    const settings: GitHubRepoSettings = {
      ...DEFAULT_GITHUB_REPO_SETTINGS,
      privacyMode: 'index_issues_prs_to_kfdb',
    };
    globalThis.fetch = mockFetch(settings);

    await api.updateRepoSettings('owner', 'repo', { privacyMode: 'index_issues_prs_to_kfdb' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${baseUrl}/github/repos/owner/repo/settings`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ privacyMode: 'index_issues_prs_to_kfdb' }),
      }),
    );
  });

  it('derives a repo session challenge', async () => {
    const challenge = {
      challengeId: 'challenge-1',
      message: 'Sign to start a repo session',
      expiresAt: '2026-05-10T12:00:00.000Z',
    };
    globalThis.fetch = mockFetch(challenge);

    const result = await api.deriveRepoSessionChallenge('owner', 'repo', {
      address: '0xabc',
      ref: 'main',
      folderScopes: ['packages/github'],
    });

    expect(result).toEqual(challenge);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${baseUrl}/github/repos/owner/repo/sessions/derive-challenge`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          address: '0xabc',
          ref: 'main',
          folderScopes: ['packages/github'],
        }),
      }),
    );
  });

  it('creates and deletes repo sessions', async () => {
    globalThis.fetch = mockFetch({
      id: 'session-1',
      owner: 'owner',
      repo: 'repo',
      ref: 'main',
      status: 'active',
      ...DEFAULT_GITHUB_REPO_SETTINGS,
      createdAt: '2026-05-10T12:00:00.000Z',
      expiresAt: '2026-05-10T13:00:00.000Z',
    });

    await api.createRepoSession('owner', 'repo', {
      challengeId: 'challenge-1',
      signature: '0xsig',
      address: '0xabc',
    });

    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      `${baseUrl}/github/repos/owner/repo/sessions`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          challengeId: 'challenge-1',
          signature: '0xsig',
          address: '0xabc',
        }),
      }),
    );

    globalThis.fetch = mockFetch(null, 204);
    await api.deleteRepoSession('session-1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${baseUrl}/github/repo-sessions/session-1`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('gets a repo session tree with path and ref query params', async () => {
    const tree = {
      repo: 'owner/repo',
      ref: 'main',
      path: 'packages/github',
      entries: [{ path: 'packages/github/src/index.ts', name: 'index.ts', type: 'file' as const }],
    };
    globalThis.fetch = mockFetch(tree);

    const result = await api.getRepoSessionTree('session-1', {
      path: 'packages/github',
      ref: 'feature/test',
    });

    expect(result).toEqual(tree);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${baseUrl}/github/repo-sessions/session-1/tree?path=packages%2Fgithub&ref=feature%2Ftest`,
      expect.any(Object),
    );
  });

  it('streams repo session chat SSE events', async () => {
    globalThis.fetch = mockSSEFetch([
      'data: {"type":"text","data":{"text":"hello"}}\n\n',
      ': heartbeat\n\n',
      'data: {"type":"done","data":{}}\n\n',
    ]);

    const events = [];
    for await (const event of api.streamRepoSessionChat('session-1', { message: 'hello' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', data: { text: 'hello' } },
      { type: 'done', data: {} },
    ]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${baseUrl}/github/repo-sessions/session-1/chat`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        }),
      }),
    );
  });
});
