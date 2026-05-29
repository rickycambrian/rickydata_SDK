/**
 * Agent Builder
 *
 * Reusable engine for creating and provisioning custom agents on the
 * RickyData agent gateway (https://agents.rickydata.org). Wraps the create-flow
 * documented in the create-flow contract:
 *
 *   create (POST /agents/custom) → skills → claude-md → agent-secrets →
 *   mcp-secrets → kb-tools/reflect → verify → chat probe
 *
 * The builder reuses {@link AgentClient} for everything it already implements
 * (upsert, secrets, reflect/kb-tools, chat) and {@link AgentMCPClient} for the
 * MCP `tools/list` verification. The two endpoints AgentClient does not expose —
 * `PUT /wallet/skills/{name}` and `PUT /wallet/claude-md/{id}` — are issued
 * directly here using the same bearer token.
 *
 * Auth: the agent gateway uses `GET /auth/challenge` + `POST /auth/verify` (NOT
 * the `/api/auth/token-message` path that `createWalletToken` targets, which 404s
 * on agents.rickydata.org). Pass a cached `mcpwt_` token or a private key and the
 * builder / AgentClient handles the challenge-verify flow.
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { AgentClient } from './agent-client.js';
import { AgentMCPClient } from './agent-mcp-client.js';
import { parseAgentMarkdown } from './recipe.js';
import type {
  AgentSpec,
  AgentRecipe,
  CreateResult,
  CustomAgentDefinition,
  SkillFile,
  VerifyResult,
} from './types.js';

const DEFAULT_GATEWAY_URL = 'https://agents.rickydata.org';

export interface AgentBuilderConfig {
  /** Pre-existing `mcpwt_` wallet token (interchangeable across gateways). */
  token?: string;
  /** Private key for wallet auth (0x-prefixed hex). Used if no token. */
  privateKey?: string;
  /** Agent gateway URL. Defaults to https://agents.rickydata.org */
  gatewayUrl?: string;
  /** Inject a pre-built AgentClient (mainly for testing). */
  client?: AgentClient;
}

export interface DeployRecipeOptions {
  /** Secret values to set, keyed by name (recipe carries names only). */
  secrets?: Record<string, string>;
  /** MCP-server secrets, keyed by serverId → { NAME: value }. */
  mcpSecrets?: Record<string, Record<string, string>>;
  /** Per-agent KFDB token (POST /agents/custom/{id}/reflect/kb-token). */
  kbToken?: string;
  /** Skip the post-deploy verify step. */
  skipVerify?: boolean;
  /** Progress callback for CLI logging. */
  onStep?: (step: string, detail?: string) => void;
}

export class AgentBuilder {
  private readonly client: AgentClient;
  private readonly gatewayUrl: string;
  private token?: string;
  private readonly privateKey?: string;

  constructor(config: AgentBuilderConfig = {}) {
    if (!config.client && !config.token && !config.privateKey) {
      throw new Error('AgentBuilder requires a token, privateKey, or a pre-built client');
    }
    this.gatewayUrl = (config.gatewayUrl ?? DEFAULT_GATEWAY_URL).replace(/\/$/, '');
    this.token = config.token;
    this.privateKey = config.privateKey;
    this.client = config.client ?? new AgentClient({
      token: config.token,
      privateKey: config.privateKey,
      gatewayUrl: this.gatewayUrl,
      sessionStorePath: null,
    });
  }

  /** The underlying AgentClient (auth, upsert, secrets, reflect, chat). */
  get agentClient(): AgentClient {
    return this.client;
  }

  // ─── Create ───────────────────────────────────────────────

  /**
   * Map an {@link AgentSpec} to a {@link CustomAgentDefinition}.
   * `name` becomes the id when none is supplied (the gateway may return a
   * `-<6hex>`-suffixed id for private agents).
   */
  static toDefinition(spec: AgentSpec): CustomAgentDefinition {
    if (!spec.name) throw new Error('spec.name is required');
    const metadata: Record<string, unknown> = { ...(spec.metadata ?? {}) };
    if (spec.agentSecrets?.length) metadata.agent_secrets = spec.agentSecrets;
    if (spec.skills?.length) metadata.skills = spec.skills;
    if (spec.visibility) metadata.visibility = spec.visibility;
    return {
      id: spec.id ?? spec.name,
      name: spec.name,
      ...(spec.title ? { title: spec.title } : {}),
      ...(spec.description ? { description: spec.description } : {}),
      ...(spec.model ? { model: spec.model } : {}),
      ...(spec.category ? { category: spec.category } : {}),
      ...(spec.mcpServers?.length ? { mcp_servers: spec.mcpServers } : {}),
      ...(spec.builtinTools?.length ? { builtin_tools: spec.builtinTools } : {}),
      systemPrompt: spec.systemPrompt,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
  }

  /**
   * Create (or upsert) an agent from a spec. Returns the resolved agent id and
   * the create-result scaffold (no skills/secrets applied — call the dedicated
   * methods or {@link deployRecipe} for the full sequence).
   */
  async createAgent(spec: AgentSpec): Promise<CreateResult> {
    const definition = AgentBuilder.toDefinition(spec);
    const result = await this.client.upsertCustomAgent(definition);
    return {
      agentId: result.agentId,
      agentName: result.agentName,
      qualityScore: result.qualityScore,
      uploadedSkills: [],
      claudeRoutingUploaded: false,
      agentSecretsSet: [],
      mcpSecretsSet: [],
      kbToolsEnabled: false,
      reflectConfigured: false,
    };
  }

  // ─── Skills ───────────────────────────────────────────────

  /**
   * Upload skill files for an agent. One `PUT /wallet/skills/{name}` per skill
   * with body `{ content, agentId }`. Returns the uploaded skill names.
   */
  async uploadSkills(agentId: string, skills: SkillFile[]): Promise<string[]> {
    if (!agentId) throw new Error('agentId is required');
    const uploaded: string[] = [];
    for (const skill of skills) {
      const res = await this.fetchWithAuth(
        `${this.gatewayUrl}/wallet/skills/${encodeURIComponent(skill.name)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ content: skill.content, agentId }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to upload skill "${skill.name}": ${res.status} ${body}`);
      }
      uploaded.push(skill.name);
    }
    return uploaded;
  }

  /** List the skills the gateway has registered for an agent. */
  async listSkills(agentId: string): Promise<string[]> {
    if (!agentId) throw new Error('agentId is required');
    const res = await this.fetchWithAuth(
      `${this.gatewayUrl}/wallet/skills/agent/${encodeURIComponent(agentId)}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to list agent skills: ${res.status} ${body}`);
    }
    const data = await res.json() as { skills?: Array<{ name: string }> };
    return (data.skills ?? []).map((s) => s.name);
  }

  // ─── CLAUDE routing ───────────────────────────────────────

  /** Upload per-agent CLAUDE routing via `PUT /wallet/claude-md/{id}`. */
  async uploadClaudeRouting(agentId: string, content: string): Promise<void> {
    if (!agentId) throw new Error('agentId is required');
    const res = await this.fetchWithAuth(
      `${this.gatewayUrl}/wallet/claude-md/${encodeURIComponent(agentId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ content }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to upload CLAUDE routing: ${res.status} ${body}`);
    }
  }

  // ─── Secrets ──────────────────────────────────────────────

  /** Set agent-level secrets (`POST /wallet/agent-secrets/{id}`). */
  async setAgentSecrets(agentId: string, secrets: Record<string, string>): Promise<string[]> {
    if (!agentId) throw new Error('agentId is required');
    if (!secrets || Object.keys(secrets).length === 0) return [];
    await this.client.storeAgentSecrets(agentId, secrets);
    return Object.keys(secrets);
  }

  /** Set MCP-server secrets (`POST /wallet/mcp-secrets/{serverId}`). */
  async setMcpSecrets(serverId: string, secrets: Record<string, string>): Promise<void> {
    if (!serverId) throw new Error('serverId is required');
    await this.client.storeMcpSecrets(serverId, secrets);
  }

  // ─── KFDB / KnowledgeBook ─────────────────────────────────

  /** Enable gateway-native KnowledgeBook (KFDB) tools for an agent. */
  async enableKbTools(agentId: string): Promise<void> {
    await this.client.setKnowledgeBookTools(agentId, true);
  }

  /** Set a per-agent KFDB token (flips `kbAuthConfigured` → true). */
  async setKbToken(agentId: string, kbToken: string): Promise<void> {
    await this.client.setKnowledgeBookToken(agentId, kbToken);
  }

  // ─── Verify ───────────────────────────────────────────────

  /**
   * Verify a provisioned agent end-to-end (read-only): existence, skills, MCP
   * tools (`tools/list`), MCP requirements, agent-secret status, and kb-tools /
   * reflect state. Best-effort — individual probes that fail are recorded as
   * absent rather than throwing.
   */
  async verify(agentId: string): Promise<VerifyResult> {
    if (!agentId) throw new Error('agentId is required');
    const result: VerifyResult = {
      agentId,
      exists: false,
      skills: [],
      tools: [],
    };

    try {
      await this.client.getCustomAgent(agentId);
      result.exists = true;
    } catch {
      result.exists = false;
    }

    try {
      result.skills = await this.listSkills(agentId);
    } catch { /* leave empty */ }

    try {
      const mcp = new AgentMCPClient({
        token: this.token,
        privateKey: this.privateKey,
        baseUrl: this.gatewayUrl,
      });
      await mcp.connect(agentId);
      const tools = await mcp.listTools(agentId);
      result.tools = tools.map((t) => t.name);
    } catch { /* leave empty */ }

    try {
      result.mcpRequirements = await this.client.getMcpRequirements(agentId);
    } catch { /* leave undefined */ }

    try {
      result.secretStatus = await this.client.getAgentSecretStatus(agentId);
    } catch { /* leave undefined */ }

    try {
      const kb = await this.client.getKnowledgeBookTools(agentId);
      result.kbToolsEnabled = kb.kbToolsEnabled;
    } catch { /* leave undefined */ }

    try {
      result.reflect = await this.client.getReflectStatus(agentId);
    } catch { /* leave undefined */ }

    return result;
  }

  /** Send a single message to an agent and return its accumulated text response. */
  async chatProbe(
    agentId: string,
    message: string,
    options?: { model?: string; onToolCall?: (name: string) => void },
  ): Promise<{ text: string; sessionId: string; toolCalls: string[] }> {
    const toolCalls: string[] = [];
    const result = await this.client.chat(agentId, message, {
      model: options?.model,
      onToolCall: (tool) => {
        toolCalls.push(tool.name);
        options?.onToolCall?.(tool.name);
      },
    });
    return { text: result.text, sessionId: result.sessionId, toolCalls };
  }

  // ─── Recipe deployment ────────────────────────────────────

  /**
   * Parse a recipe directory into an {@link AgentRecipe}.
   *
   * Layout (both skill conventions are supported):
   *   <dir>/agent.md                    YAML front-matter + markdown body (→ systemPrompt)
   *   <dir>/skills/<name>/SKILL.md       skill-per-directory (the convention the notes recipe uses)
   *   <dir>/skills/<name>.md             OR a flat one-file-per-skill layout
   *   <dir>/claude-routing.md           optional per-agent CLAUDE routing
   *
   * If the agent.md front-matter lists `skills:`, only those skills are loaded
   * (the skill name resolves to `skills/<name>/SKILL.md`, falling back to
   * `skills/<name>.md`); otherwise every skill found under `skills/` is loaded.
   */
  static async parseRecipe(dir: string): Promise<AgentRecipe> {
    const agentMdPath = path.join(dir, 'agent.md');
    let raw: string;
    try {
      raw = await fs.readFile(agentMdPath, 'utf8');
    } catch {
      throw new Error(`Recipe is missing agent.md at ${agentMdPath}`);
    }
    const spec = parseAgentMarkdown(raw);

    const skillsDir = path.join(dir, 'skills');
    const skills: SkillFile[] = [];

    // Resolve a skill name to its content file, trying both layouts.
    const loadSkill = async (name: string): Promise<string | null> => {
      const candidates = [
        path.join(skillsDir, name, 'SKILL.md'),
        path.join(skillsDir, `${name}.md`),
      ];
      for (const candidate of candidates) {
        try {
          return await fs.readFile(candidate, 'utf8');
        } catch { /* try next */ }
      }
      return null;
    };

    if (spec.skills && spec.skills.length > 0) {
      for (const name of spec.skills) {
        const content = await loadSkill(name);
        if (content === null) {
          throw new Error(
            `Recipe declares skill "${name}" but neither skills/${name}/SKILL.md nor skills/${name}.md exists`,
          );
        }
        skills.push({ name, content });
      }
    } else {
      // No explicit list — discover every skill under skills/.
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(skillsDir, { withFileTypes: true });
      } catch { /* no skills dir */ }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const content = await loadSkill(entry.name);
          if (content !== null) skills.push({ name: entry.name, content });
        } else if (entry.isFile() && /\.md$/i.test(entry.name) && entry.name.toLowerCase() !== 'skill.md') {
          const name = entry.name.replace(/\.md$/i, '');
          skills.push({ name, content: await fs.readFile(path.join(skillsDir, entry.name), 'utf8') });
        }
      }
    }
    // Keep the spec's skill list aligned with what we actually loaded.
    spec.skills = skills.map((s) => s.name);

    let claudeRouting: string | undefined;
    try {
      claudeRouting = await fs.readFile(path.join(dir, 'claude-routing.md'), 'utf8');
    } catch { /* optional */ }

    return { spec, skills, claudeRouting };
  }

  /**
   * Deploy a recipe directory end-to-end:
   *   create → skills → claude-md → agent-secrets → mcp-secrets →
   *   kb-tools/reflect → verify
   *
   * Secret values come from {@link DeployRecipeOptions} (the recipe carries names
   * only). The resolved agent id from the create call is used for every
   * subsequent step.
   */
  async deployRecipe(dir: string, options: DeployRecipeOptions = {}): Promise<CreateResult> {
    const step = options.onStep ?? (() => {});
    const recipe = await AgentBuilder.parseRecipe(dir);
    return this.deploy(recipe, options, step);
  }

  /** Deploy an already-parsed recipe. Shared by {@link deployRecipe}. */
  async deploy(
    recipe: AgentRecipe,
    options: DeployRecipeOptions = {},
    step: (s: string, detail?: string) => void = () => {},
  ): Promise<CreateResult> {
    const { spec, skills, claudeRouting } = recipe;

    step('create', spec.name);
    const created = await this.createAgent(spec);
    const agentId = created.agentId;
    step('created', agentId);

    if (skills.length > 0) {
      step('skills', `${skills.length} skill(s)`);
      created.uploadedSkills = await this.uploadSkills(agentId, skills);
    }

    if (claudeRouting) {
      step('claude-md');
      await this.uploadClaudeRouting(agentId, claudeRouting);
      created.claudeRoutingUploaded = true;
    }

    if (options.secrets && Object.keys(options.secrets).length > 0) {
      step('agent-secrets', Object.keys(options.secrets).join(', '));
      created.agentSecretsSet = await this.setAgentSecrets(agentId, options.secrets);
    }

    if (options.mcpSecrets) {
      for (const [serverId, secrets] of Object.entries(options.mcpSecrets)) {
        if (!secrets || Object.keys(secrets).length === 0) continue;
        step('mcp-secrets', serverId);
        await this.setMcpSecrets(serverId, secrets);
        created.mcpSecretsSet.push(serverId);
      }
    }

    if (spec.kbTools) {
      step('kb-tools');
      await this.enableKbTools(agentId);
      created.kbToolsEnabled = true;
    }

    if (options.kbToken) {
      step('kb-token');
      await this.setKbToken(agentId, options.kbToken);
    }

    if (spec.reflect && (spec.reflect.enabled !== undefined || spec.reflect.config)) {
      step('reflect');
      await this.client.updateReflectConfig(agentId, spec.reflect);
      created.reflectConfigured = true;
    }

    if (!options.skipVerify) {
      step('verify');
      await this.verify(agentId);
    }

    return created;
  }

  // ─── Internal ─────────────────────────────────────────────

  /**
   * fetch with the gateway bearer token attached. Reuses the AgentClient's auth
   * (it resolves a token from a cached `mcpwt_` token or via challenge/verify),
   * which keeps the skills/claude-md PUTs on the same auth path as everything else.
   */
  private async fetchWithAuth(url: string, init: RequestInit): Promise<Response> {
    const token = await this.resolveToken();
    return fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  /**
   * Resolve a bearer token for the skills/claude-md PUTs (which AgentClient does
   * not wrap). Prefers a supplied/cached `mcpwt_` token; otherwise runs the agent
   * gateway's challenge/verify flow with the configured private key. The token is
   * cached for subsequent calls.
   */
  private async resolveToken(): Promise<string> {
    if (this.token) return this.token;
    if (this.privateKey) {
      this.token = await challengeVerifyToken(this.gatewayUrl, this.privateKey);
      return this.token;
    }
    throw new Error(
      'No bearer token available. Construct AgentBuilder with a token, or with a privateKey ' +
        'so the builder can run the challenge/verify flow before skill/claude-md uploads.',
    );
  }
}

/**
 * Mint a wallet token against the AGENT gateway via `GET /auth/challenge` +
 * `POST /auth/verify`. This is the path that works on agents.rickydata.org
 * (the `/api/auth/token-message` path used by `createWalletToken` 404s there).
 */
export async function challengeVerifyToken(
  gatewayUrl: string,
  privateKey: string,
): Promise<string> {
  const base = gatewayUrl.replace(/\/$/, '');
  const key = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(key);

  const challengeRes = await fetch(`${base}/auth/challenge`);
  if (!challengeRes.ok) {
    throw new Error(`Auth challenge failed: ${challengeRes.status}`);
  }
  const { nonce, message } = await challengeRes.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message });

  const verifyRes = await fetch(`${base}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: account.address, signature, nonce }),
  });
  if (!verifyRes.ok) {
    const body = await verifyRes.text();
    throw new Error(`Auth verification failed: ${verifyRes.status} ${body}`);
  }
  const { token } = await verifyRes.json() as { token: string };
  return token;
}
