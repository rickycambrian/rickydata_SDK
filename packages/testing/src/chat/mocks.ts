/**
 * Mock helpers for unit-testing code that uses AgentClient.
 * Extracted and generalized from core/tests/agent-client.test.ts.
 */

import type { SSEEvent } from 'rickydata/agent';

// ─── Constants ──────────────────────────────────────────

/** Hardhat account #0 — safe for tests, never use on mainnet. */
export const TEST_PRIVATE_KEY = process.env.TEST_WALLET_KEY ?? '<TEST_WALLET_KEY>';
export const TEST_WALLET_ADDRESS = process.env.TEST_WALLET_ADDRESS ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
export const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';

// ─── SSE Stream ─────────────────────────────────────────

/** Create a ReadableStream of SSE-encoded events (for mocking fetch response bodies). */
export function createSSEStream(events: SSEEvent[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map(e => `data: ${JSON.stringify(e)}\n\n`);
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

// ─── Fetch Spy Helpers ──────────────────────────────────

interface FetchSpy {
  mockResolvedValueOnce(value: unknown): FetchSpy;
  mockRejectedValueOnce(value: unknown): FetchSpy;
}

/** Mock the auth challenge + verify flow on a fetch spy. Returns the spy for chaining. */
export function mockAuthFlow(fetchSpy: FetchSpy): FetchSpy {
  // Challenge
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ nonce: 'nonce-123', message: 'Sign this message' }),
  } as Response);
  // Verify
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ token: 'jwt-token-123', walletAddress: TEST_WALLET_ADDRESS }),
  } as Response);
  return fetchSpy;
}

/** Mock session creation on a fetch spy. Returns the spy for chaining. */
export function mockSessionCreation(fetchSpy: FetchSpy, sessionId = 'sess-test-1'): FetchSpy {
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ id: sessionId }),
  } as Response);
  return fetchSpy;
}

/**
 * Mock a complete chat response pipeline: auth → session → SSE stream.
 * Returns the fetch spy for further assertions.
 */
export function mockChatResponse(
  fetchSpy: FetchSpy,
  events: SSEEvent[],
  options?: { sessionId?: string },
): FetchSpy {
  mockAuthFlow(fetchSpy);
  mockSessionCreation(fetchSpy, options?.sessionId);
  fetchSpy.mockResolvedValueOnce({
    ok: true,
    body: createSSEStream(events),
  } as unknown as Response);
  return fetchSpy;
}
