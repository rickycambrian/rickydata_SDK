/**
 * Voice overlap detection — verify that requesting a second voice token
 * closes the first room (session dedup).
 */

export interface VoiceTokenResult {
  token: string;
  roomName: string;
  sessionId: string;
}

/**
 * Request two voice tokens in quick succession for the same agent.
 * Returns both results. If dedup is working, the second request should
 * have a different room name (the first room was closed).
 */
export async function requestTwoVoiceTokens(
  baseUrl: string,
  authToken: string,
  agentId: string,
  model?: string,
): Promise<{ first: VoiceTokenResult; second: VoiceTokenResult }> {
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify({ model: model || 'claude-haiku-4-5-20251001' });

  const firstRes = await fetch(`${baseUrl}/agents/${agentId}/voice/livekit-token`, {
    method: 'POST', headers, body,
  });
  if (!firstRes.ok) throw new Error(`First voice token failed: ${firstRes.status}`);
  const first = await firstRes.json() as VoiceTokenResult;

  // Small delay to ensure the first session is registered
  await new Promise(r => setTimeout(r, 500));

  const secondRes = await fetch(`${baseUrl}/agents/${agentId}/voice/livekit-token`, {
    method: 'POST', headers, body,
  });
  if (!secondRes.ok) throw new Error(`Second voice token failed: ${secondRes.status}`);
  const second = await secondRes.json() as VoiceTokenResult;

  return { first, second };
}

/**
 * Assert that two voice tokens have different room names (dedup working).
 */
export function assertDifferentRooms(first: VoiceTokenResult, second: VoiceTokenResult): string[] {
  const failures: string[] = [];
  if (first.roomName === second.roomName) {
    failures.push(`Both requests returned same room: ${first.roomName} — dedup not working`);
  }
  // Session IDs should also differ
  if (first.sessionId === second.sessionId) {
    failures.push(`Both requests returned same session: ${first.sessionId}`);
  }
  return failures;
}
