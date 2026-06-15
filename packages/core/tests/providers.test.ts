import { describe, expect, it } from 'vitest';
import {
  PROVIDERS,
  fallbackChain,
  fallbackModel,
  parseCodexAuth,
  providerAvailability,
  providerFromModel,
  resolveApiKey,
  resolveJudgeModel,
  resolveRoleModel,
} from '../src/providers/index.js';

describe('provider registry', () => {
  it('declares the five subscription providers with verified endpoints', () => {
    expect(PROVIDERS.zai.baseUrl).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(PROVIDERS.zai.protocol).toBe('openai');
    expect(PROVIDERS.minimax.baseUrl).toBe('https://api.minimax.io/anthropic');
    expect(PROVIDERS.minimax.protocol).toBe('anthropic');
    expect(PROVIDERS.kimi.baseUrl).toBe('https://api.kimi.com/coding');
    expect(PROVIDERS.kimi.protocol).toBe('anthropic');
    expect(PROVIDERS.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(PROVIDERS.openai.protocol).toBe('openai');
    expect(PROVIDERS.opencode.baseUrl).toBe('https://opencode.ai/zen/go/v1');
    expect(PROVIDERS.opencode.protocol).toBe('openai');
  });

  it('never lists an Anthropic provider', () => {
    expect(Object.keys(PROVIDERS)).not.toContain('anthropic');
    for (const spec of Object.values(PROVIDERS)) {
      expect(spec.baseUrl).not.toContain('api.anthropic.com');
      expect(spec.envKeys).not.toContain('ANTHROPIC_API_KEY');
    }
  });
});

describe('providerFromModel', () => {
  const table: Array<[string, string]> = [
    ['glm-5.1', 'zai'],
    ['MiniMax-M3', 'minimax'],
    ['MiniMax-M2.7', 'minimax'],
    ['minimax-m2.7-highspeed', 'minimax'],
    ['kimi-k2.7-code', 'kimi'],
    ['kimi-for-coding', 'kimi'],
    ['gpt-5.5', 'openai'],
    ['opencode-go/deepseek-v4-flash', 'opencode'],
  ];
  for (const [model, provider] of table) {
    it(`maps ${model} -> ${provider}`, () => {
      expect(providerFromModel(model)).toBe(provider);
    });
  }

  it('rejects Anthropic models outright (no-Anthropic rule)', () => {
    for (const model of ['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'sonnet', 'opus']) {
      expect(() => providerFromModel(model)).toThrow(/anthropic/i);
    }
  });

  it('rejects unknown models with the model name in the error', () => {
    expect(() => providerFromModel('mystery-9000')).toThrow(/mystery-9000/);
  });
});

describe('fallbackModel', () => {
  it('maps kimi models to gpt-5.5 (reliable forced-tool emitter; coding-plan quota fallback)', () => {
    // gpt-5.5 (codex) is the live-proven reliable forced-tool/discriminator emitter.
    // MiniMax was observed to DROP the ActionSchema discriminator under forced output
    // (live eval 2026-06-14: "action: Required" after retry), so it is NOT a safe
    // structured-output fallback target — fall back to gpt-5.5 instead.
    expect(fallbackModel('kimi-k2.7-code')).toBe('gpt-5.5');
    expect(fallbackModel('kimi-for-coding')).toBe('gpt-5.5');
  });

  it('returns null for models without a defined fallback', () => {
    expect(fallbackModel('MiniMax-M3')).toBeNull();
    expect(fallbackModel('glm-5.1')).toBeNull();
    expect(fallbackModel('gpt-5.5')).toBeNull();
  });

  describe('availability-aware (WS-F): kimi -> first AVAILABLE fallback target', () => {
    // The Cloud Run container has NO codex auth + NO OPENAI_API_KEY, so gpt-5.5 is
    // unreachable there — the old static kimi->gpt-5.5 hop was a dead end in prod.
    // When env (+codexAuth) is passed, fallbackModel resolves to the first preference
    // whose creds are actually present: gpt-5.5 locally, MiniMax-M3 in prod.
    it('prefers gpt-5.5 when OpenAI creds ARE present', () => {
      const env = { OPENAI_API_KEY: 'ok', MINIMAX_API_KEY: 'mk', ZAI_API_KEY: 'zk' };
      expect(fallbackModel('kimi-k2.7-code', env)).toBe('gpt-5.5');
    });

    it('self-heals to MiniMax-M3 in the prod container (no OpenAI key, no codex auth)', () => {
      // exactly the Cloud Run matrix: MiniMax + opencode present, NO openai/codex.
      const env = { MINIMAX_API_KEY: 'mk', OPENCODE_API_KEY: 'ock' };
      expect(fallbackModel('kimi-k2.7-code', env, null)).toBe('MiniMax-M3');
    });

    it('counts codex subscription auth as OpenAI availability (gpt-5.5 wins)', () => {
      const env = { MINIMAX_API_KEY: 'mk' };
      const codex = { accessToken: 't', accountId: null };
      expect(fallbackModel('kimi-k2.7-code', env, codex)).toBe('gpt-5.5');
    });

    it('drops past MiniMax to glm-5.1, then opencode, by availability', () => {
      expect(fallbackModel('kimi-k2.7-code', { ZAI_API_KEY: 'zk' }, null)).toBe('glm-5.1');
      expect(fallbackModel('kimi-k2.7-code', { OPENCODE_API_KEY: 'ock' }, null)).toBe(
        'opencode-go/deepseek-v4-flash',
      );
    });

    it('returns null when NO fallback provider has creds (caller surfaces original error)', () => {
      expect(fallbackModel('kimi-k2.7-code', {}, null)).toBeNull();
    });

    it('without env it stays the static gpt-5.5 default (back-compat for one-arg callers)', () => {
      expect(fallbackModel('kimi-k2.7-code')).toBe('gpt-5.5');
    });
  });

  describe('non-kimi models also get a fallback target (prod self-heal)', () => {
    // PROD OUTAGE 2026-06-14: the deployed model is MiniMax-M3 (kimi 403 + Z.ai 429
    // until 2026-06-19), but fallbackModel was kimi-ONLY, so when MiniMax-M3 failed
    // there was NO fallback even though OpenCode Go is live in the same container —
    // project-create returned "no tool_use block" and a practice turn 500'd. The
    // env-aware form must hop ANY failing model to the first available DIFFERENT-
    // provider target.
    it('falls MiniMax-M3 over to opencode in the prod container matrix (no openai/zai live)', () => {
      const env = { MINIMAX_PLATFORM_KEY: 'mk', OPENCODE_API_KEY: 'ock' };
      expect(fallbackModel('MiniMax-M3', env, null)).toBe('opencode-go/deepseek-v4-flash');
    });

    it('prefers gpt-5.5 for a non-kimi failing model when OpenAI creds are present', () => {
      const env = { MINIMAX_PLATFORM_KEY: 'mk', OPENAI_API_KEY: 'ok' };
      expect(fallbackModel('MiniMax-M3', env, null)).toBe('gpt-5.5');
    });

    it('never falls a model back to its OWN provider (no minimax->minimax)', () => {
      expect(fallbackModel('MiniMax-M3', { MINIMAX_PLATFORM_KEY: 'mk' }, null)).toBeNull();
    });

    it('one-arg legacy form stays null for non-kimi (eval determinism unchanged)', () => {
      expect(fallbackModel('MiniMax-M3')).toBeNull();
    });
  });

  describe('fallbackChain (multi-hop candidates, distinct providers, skip self)', () => {
    it('lists every credentialed non-self provider in preference order', () => {
      // prod matrix: minimax(self) + zai + opencode + kimi keyed, no openai/codex.
      const env = {
        MINIMAX_PLATFORM_KEY: 'mk',
        ZAI_API_KEY: 'zk',
        OPENCODE_API_KEY: 'ock',
        KIMI_API_KEY: 'kk',
      };
      expect(fallbackChain('MiniMax-M3', env, null)).toEqual([
        'glm-5.1',
        'opencode-go/deepseek-v4-flash',
        'kimi-k2.7-code',
      ]);
    });

    it('excludes the failing model own provider and unkeyed providers', () => {
      const env = { MINIMAX_PLATFORM_KEY: 'mk', OPENCODE_API_KEY: 'ock' };
      expect(fallbackChain('MiniMax-M3', env, null)).toEqual(['opencode-go/deepseek-v4-flash']);
    });

    it('is empty when only the failing provider has creds', () => {
      expect(fallbackChain('MiniMax-M3', { MINIMAX_PLATFORM_KEY: 'mk' }, null)).toEqual([]);
    });
  });
});

describe('resolveApiKey', () => {
  it('takes the first env key that is set and non-empty', () => {
    expect(
      resolveApiKey(PROVIDERS.minimax, { MINIMAX_API_KEY: '', MINIMAX_PLATFORM_KEY: 'pk' }),
    ).toEqual({ key: 'pk', source: 'MINIMAX_PLATFORM_KEY' });
    expect(
      resolveApiKey(PROVIDERS.minimax, { MINIMAX_API_KEY: 'ak', MINIMAX_PLATFORM_KEY: 'pk' }),
    ).toEqual({ key: 'ak', source: 'MINIMAX_API_KEY' });
    expect(resolveApiKey(PROVIDERS.zai, {})).toBeNull();
  });
});

describe('parseCodexAuth', () => {
  it('extracts access token and account id from auth.json shape', () => {
    const payload = Buffer.from(
      JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } }),
    ).toString('base64url');
    const jwt = `${Buffer.from('{}').toString('base64url')}.${payload}.${Buffer.from('sig').toString('base64url')}`;
    const auth = parseCodexAuth({
      tokens: { access_token: 'tok', id_token: jwt },
    });
    expect(auth).toEqual({ accessToken: 'tok', accountId: 'acct_1' });
  });

  it('prefers explicit tokens.account_id', () => {
    const auth = parseCodexAuth({ tokens: { access_token: 'tok', account_id: 'acct_2' } });
    expect(auth).toEqual({ accessToken: 'tok', accountId: 'acct_2' });
  });

  it('returns null without an access token', () => {
    expect(parseCodexAuth({})).toBeNull();
    expect(parseCodexAuth({ tokens: { access_token: '' } })).toBeNull();
  });
});

describe('providerAvailability + role model resolution', () => {
  const env = { MINIMAX_PLATFORM_KEY: 'mk', KIMI_API_KEY: 'kk' };

  it('reports which providers have credentials', () => {
    const avail = providerAvailability(env, null);
    expect(avail.find((a) => a.id === 'minimax')).toMatchObject({
      hasKey: true,
      source: 'MINIMAX_PLATFORM_KEY',
    });
    expect(avail.find((a) => a.id === 'zai')).toMatchObject({ hasKey: false });
    expect(avail.find((a) => a.id === 'openai')).toMatchObject({ hasKey: false });
  });

  it('counts codex subscription auth as openai availability', () => {
    const avail = providerAvailability({}, { accessToken: 't', accountId: null });
    expect(avail.find((a) => a.id === 'openai')).toMatchObject({
      hasKey: true,
      source: 'codex-subscription',
    });
  });

  it('explicit env override wins for a role', () => {
    expect(
      resolveRoleModel('simulator', { ...env, SALES_COACH_SIMULATOR_MODEL: 'kimi-k2.7-code' }),
    ).toBe('kimi-k2.7-code');
  });

  it('rejects an Anthropic model override', () => {
    expect(() =>
      resolveRoleModel('coach', { ...env, SALES_COACH_COACH_MODEL: 'claude-opus-4-8' }),
    ).toThrow(/anthropic/i);
  });

  it('falls back to the first preference whose provider has a key', () => {
    // Simulator + coach now favor kimi-k2.7-code; kimi has a key here.
    expect(resolveRoleModel('simulator', env)).toBe('kimi-k2.7-code');
    expect(resolveRoleModel('coach', env)).toBe('kimi-k2.7-code');
    expect(resolveRoleModel('judge', env)).toBe('kimi-k2.7-code');
  });

  it('drops to MiniMax-M3 for simulator/coach when only minimax has a key', () => {
    const minimaxOnly = { MINIMAX_PLATFORM_KEY: 'mk' };
    expect(resolveRoleModel('simulator', minimaxOnly)).toBe('MiniMax-M3');
    expect(resolveRoleModel('coach', minimaxOnly)).toBe('MiniMax-M3');
  });

  it('prefers gpt-5.5 over MiniMax when Kimi is down (reliable forced-tool emitter)', () => {
    // Live eval 2026-06-14: MiniMax drops the forced ActionSchema discriminator
    // ("action: Required"), gpt-5.5 emits it reliably. So with Kimi quota-exhausted,
    // the coach/simulator/init default must resolve to gpt-5.5, not MiniMax.
    const noKimi = { MINIMAX_PLATFORM_KEY: 'mk', OPENAI_API_KEY: 'ok' };
    expect(resolveRoleModel('simulator', noKimi)).toBe('gpt-5.5');
    expect(resolveRoleModel('coach', noKimi)).toBe('gpt-5.5');
  });

  it('throws a setup-guidance error when no provider has a key', () => {
    expect(() => resolveRoleModel('simulator', {})).toThrow(/provider/);
  });

  it('judge resolution avoids the judged model provider', () => {
    // Judged model on kimi -> judge must come from a different provider.
    const judge = resolveJudgeModel(env, 'kimi-k2.7-code');
    expect(providerFromModel(judge)).not.toBe('kimi');
    // Judged model on minimax -> kimi judge is fine.
    expect(providerFromModel(resolveJudgeModel(env, 'MiniMax-M2.7'))).toBe('kimi');
  });
});
