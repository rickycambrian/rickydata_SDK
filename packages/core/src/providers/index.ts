/**
 * Subscription-provider registry (`rickydata/providers`).
 *
 * HARD RULE: this layer NEVER talks to the Anthropic API. All LLM traffic goes
 * through flat-cost subscription providers (Z.ai, MiniMax, Kimi, OpenAI via the
 * Codex subscription, OpenCode Go). Lifted from rickydata_sales_coach
 * (src/llm/providers.ts) so the stack can import it instead of vendoring.
 *
 * NOTE: `providerFromModel` here REJECTS claude-* / opus / sonnet / haiku / fable
 * (the sales_coach semantics) — this is intentionally the OPPOSITE of the SDK's
 * private agent-client `providerFromModel`, which maps claude -> anthropic. The
 * two are separate by design; this module is purely additive.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ProviderId = 'zai' | 'minimax' | 'kimi' | 'openai' | 'opencode';

/** Wire protocol: anthropic-compatible /v1/messages or openai-compatible /chat/completions. */
export type Protocol = 'anthropic' | 'openai';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  protocol: Protocol;
  baseUrl: string;
  /** First env var found wins (live.rs candidate order). */
  envKeys: string[];
  defaultModel: string;
  models: string[];
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  zai: {
    id: 'zai',
    label: 'Z.ai (GLM)',
    protocol: 'openai',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    envKeys: ['ZAI_API_KEY', 'ZAI_PLATFORM_KEY'],
    defaultModel: 'glm-5.1',
    models: ['glm-5.1'],
  },
  minimax: {
    id: 'minimax',
    label: 'MiniMax',
    protocol: 'anthropic',
    baseUrl: 'https://api.minimax.io/anthropic',
    envKeys: ['MINIMAX_API_KEY', 'MINIMAX_PLATFORM_KEY'],
    defaultModel: 'MiniMax-M2.7',
    models: ['MiniMax-M3', 'MiniMax-M2.7'],
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi (Moonshot coding)',
    protocol: 'anthropic',
    baseUrl: 'https://api.kimi.com/coding',
    envKeys: ['KIMI_API_KEY', 'KIMI_PLATFORM_KEY'],
    defaultModel: 'kimi-k2.7-code',
    models: ['kimi-k2.7-code', 'kimi-for-coding'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (Codex subscription)',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    envKeys: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-5.5',
    models: ['gpt-5.5'],
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode Go',
    protocol: 'openai',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    envKeys: ['OPENCODE_API_KEY'],
    defaultModel: 'opencode-go/deepseek-v4-flash',
    models: ['opencode-go/deepseek-v4-flash', 'opencode-go/kimi-k2.6'],
  },
};

export type Env = Record<string, string | undefined>;

const ANTHROPIC_HINTS = ['claude', 'haiku', 'sonnet', 'opus', 'anthropic', 'fable', 'mythos'];

/**
 * Resolve a subscription ProviderId from a model name. THROWS on any Anthropic
 * model (claude-* / opus / sonnet / haiku / fable / anthropic / mythos) — this
 * layer never uses the Anthropic API — and throws on unknown models.
 */
export function providerFromModel(model: string): ProviderId {
  const value = model.trim().toLowerCase();
  if (!value) throw new Error('providerFromModel: empty model name');
  if (ANTHROPIC_HINTS.some((h) => value === h || value.includes(h))) {
    throw new Error(
      `Model "${model}" routes to the Anthropic API, which this layer never uses. ` +
        'Pick a subscription-provider model (glm-5.1, MiniMax-M2.7, kimi-k2.7-code, gpt-5.5, opencode-go/...).',
    );
  }
  if (value.startsWith('opencode-go/') || value.includes('opencode')) return 'opencode';
  if (value.includes('minimax')) return 'minimax';
  if (value.startsWith('glm') || value.includes('z.ai') || value.includes('zai')) return 'zai';
  if (value.startsWith('kimi')) return 'kimi';
  if (value.startsWith('gpt-') || value.startsWith('o1') || value.startsWith('o3') || value.startsWith('o4'))
    return 'openai';
  throw new Error(
    `Cannot infer a provider for model "${model}". Known models: ` +
      Object.values(PROVIDERS)
        .flatMap((p) => p.models)
        .join(', '),
  );
}

export interface ResolvedKey {
  key: string;
  source: string;
}

export function resolveApiKey(spec: ProviderSpec, env: Env): ResolvedKey | null {
  for (const name of spec.envKeys) {
    const value = env[name];
    if (value && value.trim() !== '') return { key: value, source: name };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Codex subscription auth (GPT-5.5 without an OpenAI API key).
// ---------------------------------------------------------------------------

export interface CodexAuth {
  accessToken: string;
  accountId: string | null;
}

export function parseCodexAuth(value: unknown): CodexAuth | null {
  if (typeof value !== 'object' || value === null) return null;
  const tokens = (value as Record<string, unknown>)['tokens'];
  if (typeof tokens !== 'object' || tokens === null) return null;
  const t = tokens as Record<string, unknown>;
  const accessToken = typeof t['access_token'] === 'string' ? t['access_token'].trim() : '';
  if (!accessToken) return null;

  let accountId: string | null =
    typeof t['account_id'] === 'string' && t['account_id'].trim() !== ''
      ? (t['account_id'] as string)
      : null;
  if (!accountId && typeof t['id_token'] === 'string') {
    const claims = jwtPayload(t['id_token'] as string);
    const auth = claims?.['https://api.openai.com/auth'];
    if (typeof auth === 'object' && auth !== null) {
      const id = (auth as Record<string, unknown>)['chatgpt_account_id'];
      if (typeof id === 'string' && id !== '') accountId = id;
    }
  }
  return { accessToken, accountId };
}

function jwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function loadCodexAuth(env: Env = process.env): CodexAuth | null {
  const home = env['CODEX_HOME'] || join(env['HOME'] ?? homedir(), '.codex');
  try {
    return parseCodexAuth(JSON.parse(readFileSync(join(home, 'auth.json'), 'utf-8')));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Availability + role-based model resolution
// ---------------------------------------------------------------------------

export interface ProviderAvailabilityEntry {
  id: ProviderId;
  label: string;
  hasKey: boolean;
  source: string | null;
}

export function providerAvailability(
  env: Env,
  codexAuth: CodexAuth | null,
): ProviderAvailabilityEntry[] {
  return Object.values(PROVIDERS).map((spec) => {
    const resolved = resolveApiKey(spec, env);
    if (resolved) return { id: spec.id, label: spec.label, hasKey: true, source: resolved.source };
    if (spec.id === 'openai' && codexAuth) {
      return { id: spec.id, label: spec.label, hasKey: true, source: 'codex-subscription' };
    }
    return { id: spec.id, label: spec.label, hasKey: false, source: null };
  });
}

export type LLMRole = 'simulator' | 'coach' | 'judge';

export const ROLE_ENV_VARS: Record<LLMRole, string> = {
  simulator: 'SALES_COACH_SIMULATOR_MODEL',
  coach: 'SALES_COACH_COACH_MODEL',
  judge: 'SALES_COACH_JUDGE_MODEL',
};

/**
 * Preference order per role. Simulator + coach favor kimi-k2.7-code (coding
 * plan, flat cost) when its quota is healthy, then gpt-5.5 — the live-proven
 * reliable forced-tool/discriminator emitter (codex subscription, key-free) — and
 * only then MiniMax-M3. gpt-5.5 sits ahead of MiniMax because MiniMax was observed
 * to DROP the forced ActionSchema discriminator under structured output, so it must
 * not be the default init/coach emitter while Kimi is down. glm-5.1 is a later
 * fallback. Judge defaults to a different provider than the usual simulator/coach
 * picks to avoid self-judging.
 */
const ROLE_PREFERENCES: Record<LLMRole, string[]> = {
  simulator: ['kimi-k2.7-code', 'gpt-5.5', 'MiniMax-M3', 'glm-5.1', 'opencode-go/deepseek-v4-flash'],
  coach: ['kimi-k2.7-code', 'gpt-5.5', 'MiniMax-M3', 'glm-5.1', 'opencode-go/deepseek-v4-flash'],
  judge: ['kimi-k2.7-code', 'gpt-5.5', 'glm-5.1', 'MiniMax-M2.7', 'opencode-go/deepseek-v4-flash'],
};

/**
 * Quota-fallback preference for kimi coding-plan models: when kimi hits a quota/limit,
 * retry on the first of these whose creds are actually present. gpt-5.5 (codex) is
 * preferred — the live-proven reliable forced-tool/discriminator emitter — then
 * MiniMax-M3, glm-5.1, opencode.
 */
const KIMI_FALLBACK_PREFERENCE = ['gpt-5.5', 'MiniMax-M3', 'glm-5.1', 'opencode-go/deepseek-v4-flash'];

/**
 * General quota-fallback order for ANY (non-kimi) failing model. gpt-5.5 first, then
 * the remaining credentialed providers — kept distinct from KIMI_FALLBACK_PREFERENCE
 * so kimi's tuned order is untouched. The failing model's OWN provider is filtered out
 * by `fallbackChain`, so listing every provider here is harmless.
 */
const GENERAL_FALLBACK_PREFERENCE = [
  'gpt-5.5',
  'MiniMax-M3',
  'glm-5.1',
  'opencode-go/deepseek-v4-flash',
  'kimi-k2.7-code',
];

/**
 * Ordered quota-fallback candidates for `model`, availability-aware: each entry's
 * provider has credentials in `env` (codex auth counts as OpenAI) and is DISTINCT
 * from both the failing model's provider and any earlier entry. A multi-hop walker
 * survives even when the first candidate is itself quota-dead. kimi keeps its tuned
 * KIMI_FALLBACK_PREFERENCE order; every other model uses GENERAL_FALLBACK_PREFERENCE.
 * Empty when no other credentialed provider exists, so the caller surfaces the
 * original error.
 */
export function fallbackChain(
  model: string,
  env: Env,
  codexAuth: CodexAuth | null = null,
): string[] {
  const isKimi = model.trim().toLowerCase().startsWith('kimi');
  const preference = isKimi ? KIMI_FALLBACK_PREFERENCE : GENERAL_FALLBACK_PREFERENCE;
  const available = availableProviderIds(env, codexAuth);
  const usedProviders = new Set<ProviderId>([providerFromModel(model)]);
  const chain: string[] = [];
  for (const candidate of preference) {
    const provider = providerFromModel(candidate);
    if (usedProviders.has(provider) || !available.has(provider)) continue;
    chain.push(candidate);
    usedProviders.add(provider);
  }
  return chain;
}

/**
 * First quota-fallback target for a model. Availability-aware when `env` is provided
 * (delegates to `fallbackChain`): kimi self-heals to gpt-5.5 locally / MiniMax-M3 when
 * no OpenAI creds exist; a non-kimi model hops to the first credentialed DIFFERENT
 * provider. Returns null when no other provider has creds. Called with no `env` (legacy
 * one-arg form) it keeps the back-compat static default — gpt-5.5 for kimi, null
 * otherwise — so eval determinism is unchanged.
 */
export function fallbackModel(
  model: string,
  env?: Env,
  codexAuth: CodexAuth | null = null,
): string | null {
  if (!env) {
    // legacy one-arg form: static default (kimi only), preserved for back-compat.
    return model.trim().toLowerCase().startsWith('kimi') ? 'gpt-5.5' : null;
  }
  return fallbackChain(model, env, codexAuth)[0] ?? null;
}

function availableProviderIds(env: Env, codexAuth: CodexAuth | null): Set<ProviderId> {
  return new Set(
    providerAvailability(env, codexAuth)
      .filter((a) => a.hasKey)
      .map((a) => a.id),
  );
}

export function resolveRoleModel(
  role: LLMRole,
  env: Env = process.env,
  codexAuth: CodexAuth | null = null,
): string {
  const override = env[ROLE_ENV_VARS[role]];
  if (override && override.trim() !== '') {
    providerFromModel(override); // throws on Anthropic/unknown models
    return override;
  }
  const available = availableProviderIds(env, codexAuth);
  for (const model of ROLE_PREFERENCES[role]) {
    if (available.has(providerFromModel(model))) return model;
  }
  throw new Error(
    `No subscription provider credentials found for role "${role}". ` +
      'Set one of: ' +
      Object.values(PROVIDERS)
        .map((p) => p.envKeys[0])
        .join(', '),
  );
}

/** Judge model that is guaranteed to live on a different provider than the judged model. */
export function resolveJudgeModel(
  env: Env,
  judgedModel: string,
  codexAuth: CodexAuth | null = null,
): string {
  const judgedProvider = providerFromModel(judgedModel);
  const override = env[ROLE_ENV_VARS.judge];
  if (override && override.trim() !== '' && providerFromModel(override) !== judgedProvider) {
    return override;
  }
  const available = availableProviderIds(env, codexAuth);
  for (const model of ROLE_PREFERENCES.judge) {
    const provider = providerFromModel(model);
    if (provider !== judgedProvider && available.has(provider)) return model;
  }
  throw new Error(
    `No cross-provider judge available for judged model "${judgedModel}" (provider ${judgedProvider}). ` +
      'Add a second provider key so the judge never grades its own provider.',
  );
}
