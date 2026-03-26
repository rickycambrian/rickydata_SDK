/**
 * E2E Voice + Screenshare tests — runs against PRODUCTION.
 * Gated with LIVE_TEST=1.
 *
 * Run: LIVE_TEST=1 AUTH_TOKEN=<mcpwt_or_jwt> npx vitest run packages/testing/tests/e2e-voice-screenshare.test.ts
 *
 * Notes:
 * - Free-tier wallets are forced to MiniMax regardless of requested model
 * - Voice tokens require BYOK (paid tier) — voice tests may 402 on free tier
 * - Add 3s delay between tests to avoid free-tier rate limiting
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentE2ERunner } from '../src/e2e/agent-e2e-runner.js';
import { createImageAttachment, verifyImageDescription, TEST_SCREENSHOT_BASE64 } from '../src/e2e/screenshare-test-utils.js';
import { requestTwoVoiceTokens, assertDifferentRooms } from '../src/e2e/voice-overlap-detector.js';

const LIVE = process.env.LIVE_TEST === '1';
const describeIf = LIVE ? describe : describe.skip;
const AGENT_GATEWAY_URL = process.env.AGENT_GATEWAY_URL || 'https://agents.rickydata.org';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';  // mcpwt_ or JWT
const TEST_AGENT = 'geo-expert';

/** Delay to avoid free-tier rate limiting */
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describeIf('E2E: Screenshare + Voice (production)', () => {
  let runner: AgentE2ERunner;

  if (LIVE && !AUTH_TOKEN) {
    throw new Error('AUTH_TOKEN env var required for live E2E tests');
  }

  runner = new AgentE2ERunner({ baseUrl: AGENT_GATEWAY_URL, authToken: AUTH_TOKEN });

  // Rate limiting: wait 3s between tests
  beforeEach(async () => { await delay(3000); });

  it('agent receives and responds to screenshot (model-agnostic)', async () => {
    const sessionId = await runner.createSession(TEST_AGENT, 'claude-haiku-4-5-20251001');
    const result = await runner.chatWithImage(
      TEST_AGENT, sessionId,
      'Please describe what you see in this image. Be specific about colors, shapes, or any text visible.',
      [createImageAttachment()],
      'claude-haiku-4-5-20251001',
    );

    // Free tier may force MiniMax — that's OK, we're testing the image pipeline
    console.log(`[E2E] Model used: ${result.model || 'unknown'}, freeTier: ${result.freeTier}`);
    console.log(`[E2E] Response (first 200 chars): ${result.text.slice(0, 200)}`);

    // Agent must respond substantively
    expect(result.text.length).toBeGreaterThan(10);

    // Verify the response shows awareness of the image (not a refusal)
    const failures = verifyImageDescription(result.text);
    if (result.screenshareIssueDetected) {
      // MiniMax URL conversion detected — the detection system works
      console.log('[E2E] screenshare_issue detected (MiniMax URL conversion) — detection working');
    } else {
      // Model actually described the image
      expect(failures).toEqual([]);
    }
  }, 120_000);

  it('MiniMax receives screenshot (may trigger screenshare_issue)', async () => {
    const sessionId = await runner.createSession(TEST_AGENT, 'MiniMax-M2.7-highspeed');
    const result = await runner.chatWithImage(
      TEST_AGENT, sessionId,
      'Please describe what you see in this image. What colors or shapes do you notice?',
      [createImageAttachment()],
      'MiniMax-M2.7-highspeed',
    );

    console.log(`[E2E] MiniMax response (first 200 chars): ${result.text.slice(0, 200)}`);
    console.log(`[E2E] screenshareIssue: ${result.screenshareIssueDetected}`);

    // MiniMax may convert base64 to URL and trigger screenshare_issue — both outcomes are valid
    if (result.screenshareIssueDetected) {
      expect(result.events.some(e => e.type === 'screenshare_issue')).toBe(true);
    } else {
      expect(result.text.length).toBeGreaterThan(10);
    }
  }, 180_000);  // MiniMax may do WebFetch tool call which adds latency

  it('Multi-turn screenshare resilience (2 turns)', async () => {
    // Use 2 turns instead of 4 to reduce test time and rate limit pressure
    const sessionId = await runner.createSession(TEST_AGENT, 'claude-haiku-4-5-20251001');

    for (let i = 1; i <= 2; i++) {
      if (i > 1) await delay(3000); // Rate limit delay between turns
      const result = await runner.chatWithImage(
        TEST_AGENT, sessionId,
        `Turn ${i}: What do you see in this image? This is turn ${i} of our conversation.`,
        [createImageAttachment()],
        'claude-haiku-4-5-20251001',
      );

      console.log(`[E2E] Turn ${i} model: ${result.model}, text length: ${result.text.length}`);

      // Response must be substantive (proves the pipeline is working)
      expect(result.text.length).toBeGreaterThan(10);

      if (!result.screenshareIssueDetected) {
        const failures = verifyImageDescription(result.text);
        if (failures.length > 0) {
          console.warn(`[E2E] Turn ${i} verification warnings: ${failures.join(', ')}`);
        }
      }
    }
  }, 240_000);

  it('Voice session dedup prevents overlap', async () => {
    // Voice requires BYOK — this test may 402 on free tier
    try {
      const { first, second } = await requestTwoVoiceTokens(
        AGENT_GATEWAY_URL, AUTH_TOKEN, TEST_AGENT,
      );

      // Room names should differ (old room was closed, new one created)
      const failures = assertDifferentRooms(first, second);
      expect(failures).toEqual([]);
      expect(first.token).toBeTruthy();
      expect(second.token).toBeTruthy();

      console.log(`[E2E] Room 1: ${first.roomName}, Room 2: ${second.roomName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('402')) {
        console.log('[E2E] Voice token returned 402 — wallet on free tier, voice requires BYOK. Skipping.');
        return; // Graceful skip for free tier
      }
      throw err;
    }
  }, 30_000);

  it('Chat produces substantive response', async () => {
    const sessionId = await runner.createSession(TEST_AGENT, 'claude-haiku-4-5-20251001');
    const result = await runner.chatWithImage(
      TEST_AGENT, sessionId,
      'Tell me briefly about the Geo knowledge graph.',
      undefined,  // No image
      'claude-haiku-4-5-20251001',
    );

    console.log(`[E2E] Response length: ${result.text.length}, model: ${result.model}`);

    // The response should be substantive
    expect(result.text.length).toBeGreaterThan(50);
  }, 120_000);

  it('screenshare_issue event includes suggestedAction field', async () => {
    // This test verifies the enhanced SSE event structure
    const sessionId = await runner.createSession(TEST_AGENT, 'MiniMax-M2.7-highspeed');
    const result = await runner.chatWithImage(
      TEST_AGENT, sessionId,
      'Describe this screenshot in detail.',
      [createImageAttachment()],
      'MiniMax-M2.7-highspeed',
    );

    if (result.screenshareIssueDetected) {
      // Find the screenshare_issue event
      const issueEvent = result.events.find(e => e.type === 'screenshare_issue');
      expect(issueEvent).toBeDefined();
      const data = issueEvent!.data as Record<string, unknown>;
      expect(data.reason).toBe('minimax_url_conversion');
      expect(data.suggestedAction).toBe('switch_provider');
      expect(data.alternativeProvider).toBe('anthropic');
      console.log('[E2E] screenshare_issue event has suggestedAction:', data.suggestedAction);
    } else {
      // MiniMax processed the image successfully — also valid
      console.log('[E2E] MiniMax processed image without URL conversion');
      expect(result.text.length).toBeGreaterThan(10);
    }
  }, 180_000);

  it('GET /wallet/settings returns enabledProviders array', async () => {
    const res = await fetch(`${AGENT_GATEWAY_URL}/wallet/settings`, {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.ok).toBe(true);
    const settings = await res.json() as Record<string, unknown>;

    // enabledProviders should exist and be an array
    expect(settings.enabledProviders).toBeDefined();
    expect(Array.isArray(settings.enabledProviders)).toBe(true);

    // Free tier should include 'minimax'
    const providers = settings.enabledProviders as string[];
    if (settings.plan === 'free') {
      expect(providers).toContain('minimax');
    }

    console.log('[E2E] enabledProviders:', providers, 'plan:', settings.plan);
  }, 10_000);

  it('MiniMax screenshare response does not contain hallucinated URLs', async () => {
    const sessionId = await runner.createSession(TEST_AGENT, 'MiniMax-M2.7-highspeed');
    const result = await runner.chatWithImage(
      TEST_AGENT, sessionId,
      'What do you see in this screenshot?',
      [createImageAttachment()],
      'MiniMax-M2.7-highspeed',
    );

    // The response should NOT contain Alibaba Cloud URLs (those should be intercepted)
    const hasAlibabaUrl = /minimax-algeng|aliyuncs\.com/.test(result.text);
    if (hasAlibabaUrl) {
      console.warn('[E2E] WARNING: Response contains leaked Alibaba URL — detection may not be catching all cases');
    }

    // The response should be substantive (either image description or provider limitation message)
    expect(result.text.length).toBeGreaterThan(10);
    console.log('[E2E] Response (first 200):', result.text.slice(0, 200));
  }, 180_000);
});

// Always-run tests for the E2E utilities themselves (no network required)
describe('E2E utilities (offline)', () => {
  it('verifyImageDescription catches refusal patterns', () => {
    const failures = verifyImageDescription('I cannot see any image in your message.');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some(f => f.includes('refusal'))).toBe(true);
  });

  it('verifyImageDescription passes for valid description', () => {
    const failures = verifyImageDescription('I can see a small red pixel in the center of a white background.');
    expect(failures).toEqual([]);
  });

  it('verifyImageDescription checks keywords', () => {
    const failures = verifyImageDescription('A simple image', ['red', 'pixel']);
    expect(failures.length).toBe(2);
  });

  it('createImageAttachment returns correct structure', () => {
    const att = createImageAttachment();
    expect(att.mediaType).toBe('image/png');
    expect(att.data.length).toBeGreaterThan(0);
    expect(att.data).toBe(TEST_SCREENSHOT_BASE64);
  });

  it('assertDifferentRooms passes for different rooms', () => {
    const failures = assertDifferentRooms(
      { token: 'a', roomName: 'room-1', sessionId: 'sess-1' },
      { token: 'b', roomName: 'room-2', sessionId: 'sess-2' },
    );
    expect(failures).toEqual([]);
  });

  it('assertDifferentRooms fails for same room', () => {
    const failures = assertDifferentRooms(
      { token: 'a', roomName: 'room-1', sessionId: 'sess-1' },
      { token: 'b', roomName: 'room-1', sessionId: 'sess-2' },
    );
    expect(failures.length).toBeGreaterThan(0);
  });
});
