import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { AgentBuilder } from '../src/agent/agent-builder.js';
import { AgentClient } from '../src/agent/agent-client.js';

const GATEWAY = 'https://agents.rickydata.org';
const TOKEN = 'mcpwt_test_token';

/** Build a client + builder that uses a static token (no challenge/verify). */
function makeBuilder() {
  const client = new AgentClient({ token: TOKEN, gatewayUrl: GATEWAY, sessionStorePath: null });
  const builder = new AgentBuilder({ token: TOKEN, gatewayUrl: GATEWAY, client });
  return builder;
}

/** A fetch mock that matches on URL substring + method and returns a JSON body. */
type Route = { match: RegExp; method?: string; status?: number; json?: unknown; text?: string };

function routeFetch(routes: Route[]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    if (!route) {
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      json: () => Promise.resolve(route.json ?? {}),
      text: () => Promise.resolve(route.text ?? JSON.stringify(route.json ?? {})),
    } as Response;
  });
  return { calls, spy };
}

describe('AgentBuilder', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  describe('toDefinition', () => {
    it('maps a spec to a CustomAgentDefinition', () => {
      const def = AgentBuilder.toDefinition({
        name: 'notes-qa',
        systemPrompt: 'You are a notes agent.',
        model: 'sonnet',
        category: 'productivity',
        mcpServers: ['srv-1'],
        agentSecrets: ['KFDB_API_KEY'],
        skills: ['a', 'b'],
        visibility: 'private',
      });
      expect(def.id).toBe('notes-qa');
      expect(def.name).toBe('notes-qa');
      expect(def.model).toBe('sonnet');
      expect(def.category).toBe('productivity');
      expect(def.mcp_servers).toEqual(['srv-1']);
      expect(def.systemPrompt).toBe('You are a notes agent.');
      expect(def.metadata).toMatchObject({
        agent_secrets: ['KFDB_API_KEY'],
        skills: ['a', 'b'],
        visibility: 'private',
      });
    });

    it('requires a name', () => {
      expect(() => AgentBuilder.toDefinition({ name: '', systemPrompt: 'x' })).toThrow(/name/);
    });
  });

  describe('createAgent', () => {
    it('POSTs /agents/custom with { definition }', async () => {
      const { calls } = routeFetch([
        { match: /\/agents\/custom$/, method: 'POST', json: { agentId: 'notes-qa-abc123', qualityScore: 80 } },
      ]);
      const builder = makeBuilder();
      const result = await builder.createAgent({ name: 'notes-qa', systemPrompt: 'You are a notes agent.' });

      expect(result.agentId).toBe('notes-qa-abc123');
      expect(result.qualityScore).toBe(80);
      const post = calls.find((c) => c.method === 'POST' && /\/agents\/custom$/.test(c.url))!;
      expect(post).toBeDefined();
      expect(post.body).toHaveProperty('definition');
      expect((post.body as { definition: { id: string } }).definition.id).toBe('notes-qa');
    });
  });

  describe('uploadSkills', () => {
    it('PUTs each skill to /wallet/skills/{name} with { content, agentId }', async () => {
      const { calls } = routeFetch([
        { match: /\/wallet\/skills\//, method: 'PUT', json: {} },
      ]);
      const builder = makeBuilder();
      const uploaded = await builder.uploadSkills('notes-qa-abc123', [
        { name: 'kfdb-sql-patterns', content: '# SQL' },
        { name: 'kfdb-schema-map', content: '# Schema' },
      ]);

      expect(uploaded).toEqual(['kfdb-sql-patterns', 'kfdb-schema-map']);
      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe(`${GATEWAY}/wallet/skills/kfdb-sql-patterns`);
      expect(calls[0].method).toBe('PUT');
      expect(calls[0].body).toEqual({ content: '# SQL', agentId: 'notes-qa-abc123' });
      expect(calls[1].url).toBe(`${GATEWAY}/wallet/skills/kfdb-schema-map`);
    });

    it('throws with the gateway error body on a non-2xx', async () => {
      routeFetch([{ match: /\/wallet\/skills\//, method: 'PUT', status: 403, text: 'forbidden' }]);
      const builder = makeBuilder();
      await expect(
        builder.uploadSkills('id', [{ name: 's', content: 'c' }]),
      ).rejects.toThrow(/Failed to upload skill "s": 403 forbidden/);
    });
  });

  describe('uploadClaudeRouting', () => {
    it('PUTs /wallet/claude-md/{id} with { content }', async () => {
      const { calls } = routeFetch([{ match: /\/wallet\/claude-md\//, method: 'PUT', json: {} }]);
      const builder = makeBuilder();
      await builder.uploadClaudeRouting('notes-qa-abc123', '# routing');
      expect(calls[0].url).toBe(`${GATEWAY}/wallet/claude-md/notes-qa-abc123`);
      expect(calls[0].method).toBe('PUT');
      expect(calls[0].body).toEqual({ content: '# routing' });
    });
  });

  describe('setAgentSecrets', () => {
    it('POSTs /wallet/agent-secrets/{id} with { secrets }', async () => {
      const { calls } = routeFetch([{ match: /\/wallet\/agent-secrets\//, method: 'POST', json: {} }]);
      const builder = makeBuilder();
      const names = await builder.setAgentSecrets('id', { KFDB_API_KEY: 'kf_xxx' });
      expect(names).toEqual(['KFDB_API_KEY']);
      expect(calls[0].url).toBe(`${GATEWAY}/wallet/agent-secrets/id`);
      expect(calls[0].body).toEqual({ secrets: { KFDB_API_KEY: 'kf_xxx' } });
    });

    it('is a no-op for empty secrets', async () => {
      const { calls } = routeFetch([]);
      const builder = makeBuilder();
      expect(await builder.setAgentSecrets('id', {})).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('setMcpSecrets', () => {
    it('POSTs /wallet/mcp-secrets/{serverId} with { secrets }', async () => {
      const { calls } = routeFetch([{ match: /\/wallet\/mcp-secrets\//, method: 'POST', json: {} }]);
      const builder = makeBuilder();
      await builder.setMcpSecrets('srv-1', { X_API_KEY: 'v' });
      expect(calls[0].url).toBe(`${GATEWAY}/wallet/mcp-secrets/srv-1`);
      expect(calls[0].body).toEqual({ secrets: { X_API_KEY: 'v' } });
    });
  });

  describe('enableKbTools', () => {
    it('PUTs /agents/custom/{id}/kb-tools with { enabled: true }', async () => {
      const { calls } = routeFetch([
        { match: /\/agents\/custom\/.*\/kb-tools$/, method: 'PUT', json: { kbToolsEnabled: true } },
      ]);
      const builder = makeBuilder();
      await builder.enableKbTools('notes-qa-abc123');
      expect(calls[0].url).toBe(`${GATEWAY}/agents/custom/notes-qa-abc123/kb-tools`);
      expect(calls[0].body).toEqual({ enabled: true });
    });
  });

  describe('deploy', () => {
    it('runs create → skills → claude-md → agent-secrets → mcp-secrets → kb-tools in order', async () => {
      const { calls } = routeFetch([
        { match: /\/agents\/custom$/, method: 'POST', json: { agentId: 'notes-qa-abc123' } },
        { match: /\/wallet\/skills\//, method: 'PUT', json: {} },
        { match: /\/wallet\/claude-md\//, method: 'PUT', json: {} },
        { match: /\/wallet\/agent-secrets\//, method: 'POST', json: {} },
        { match: /\/wallet\/mcp-secrets\//, method: 'POST', json: {} },
        { match: /\/agents\/custom\/.*\/kb-tools$/, method: 'PUT', json: { kbToolsEnabled: true } },
      ]);
      const builder = makeBuilder();
      const recipe = {
        spec: {
          name: 'notes-qa',
          systemPrompt: 'You are a notes agent.',
          model: 'sonnet',
          skills: ['kfdb-sql-patterns'],
          agentSecrets: ['KFDB_API_KEY'],
          kbTools: true,
        },
        skills: [{ name: 'kfdb-sql-patterns', content: '# SQL' }],
        claudeRouting: '# routing',
      };
      const result = await builder.deploy(recipe, {
        secrets: { KFDB_API_KEY: 'kf_xxx' },
        mcpSecrets: { 'srv-1': { X_API_KEY: 'v' } },
        skipVerify: true,
      });

      expect(result.agentId).toBe('notes-qa-abc123');
      expect(result.uploadedSkills).toEqual(['kfdb-sql-patterns']);
      expect(result.claudeRoutingUploaded).toBe(true);
      expect(result.agentSecretsSet).toEqual(['KFDB_API_KEY']);
      expect(result.mcpSecretsSet).toEqual(['srv-1']);
      expect(result.kbToolsEnabled).toBe(true);

      // Endpoint ordering matches the create-flow contract §4.
      const seq = calls.map((c) => `${c.method} ${c.url.replace(GATEWAY, '')}`);
      expect(seq).toEqual([
        'POST /agents/custom',
        'PUT /wallet/skills/kfdb-sql-patterns',
        'PUT /wallet/claude-md/notes-qa-abc123',
        'POST /wallet/agent-secrets/notes-qa-abc123',
        'POST /wallet/mcp-secrets/srv-1',
        'PUT /agents/custom/notes-qa-abc123/kb-tools',
      ]);

      // Subsequent steps are keyed on the agentId returned by create (with suffix).
      expect(calls[1].body).toMatchObject({ agentId: 'notes-qa-abc123' });
    });
  });

  describe('deployRecipe (filesystem parsing)', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recipe-'));
      await fs.writeFile(path.join(dir, 'agent.md'), [
        '---',
        'name: notes-qa',
        'model: sonnet',
        'public: false',
        'kb_tools: true',
        'agent_secrets: KFDB_API_KEY',
        'skills: kfdb-sql-patterns,kfdb-schema-map',
        '---',
        '',
        'You are a notes agent.',
      ].join('\n'));
      await fs.writeFile(path.join(dir, 'claude-routing.md'), '# routing');
      // Skill-per-directory layout (matches the notes recipe).
      await fs.mkdir(path.join(dir, 'skills', 'kfdb-sql-patterns'), { recursive: true });
      await fs.writeFile(path.join(dir, 'skills', 'kfdb-sql-patterns', 'SKILL.md'), '# SQL patterns');
      // Flat layout (fallback) for the second skill.
      await fs.writeFile(path.join(dir, 'skills', 'kfdb-schema-map.md'), '# Schema map');
    });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it('parses both skill layouts and runs the full deploy sequence', async () => {
      const { calls } = routeFetch([
        { match: /\/agents\/custom$/, method: 'POST', json: { agentId: 'notes-qa-abc123' } },
        { match: /\/wallet\/skills\//, method: 'PUT', json: {} },
        { match: /\/wallet\/claude-md\//, method: 'PUT', json: {} },
        { match: /\/wallet\/agent-secrets\//, method: 'POST', json: {} },
        { match: /\/agents\/custom\/.*\/kb-tools$/, method: 'PUT', json: { kbToolsEnabled: true } },
      ]);
      const builder = makeBuilder();
      const result = await builder.deployRecipe(dir, {
        secrets: { KFDB_API_KEY: 'kf_xxx' },
        skipVerify: true,
      });

      expect(result.uploadedSkills).toEqual(['kfdb-sql-patterns', 'kfdb-schema-map']);
      expect(result.claudeRoutingUploaded).toBe(true);
      expect(result.kbToolsEnabled).toBe(true);

      const skillPuts = calls.filter((c) => /\/wallet\/skills\//.test(c.url));
      expect(skillPuts[0].body).toEqual({ content: '# SQL patterns', agentId: 'notes-qa-abc123' });
      expect(skillPuts[1].body).toEqual({ content: '# Schema map', agentId: 'notes-qa-abc123' });
    });

    it('parses the recipe without deploying via parseRecipe', async () => {
      const recipe = await AgentBuilder.parseRecipe(dir);
      expect(recipe.spec.name).toBe('notes-qa');
      expect(recipe.spec.visibility).toBe('private');
      expect(recipe.spec.kbTools).toBe(true);
      expect(recipe.skills.map((s) => s.name)).toEqual(['kfdb-sql-patterns', 'kfdb-schema-map']);
      expect(recipe.claudeRouting).toBe('# routing');
    });

    it('throws when a declared skill file is missing', async () => {
      await fs.rm(path.join(dir, 'skills', 'kfdb-schema-map.md'));
      await expect(AgentBuilder.parseRecipe(dir)).rejects.toThrow(/kfdb-schema-map/);
    });
  });

  describe('verify', () => {
    it('aggregates existence, MCP tools, requirements, secret + kb status (best-effort)', async () => {
      const { calls } = routeFetch([
        { match: /\/agents\/custom\/notes-qa-abc123$/, method: 'GET', json: { id: 'notes-qa-abc123' } },
        { match: /\/wallet\/skills\/agent\//, method: 'GET', json: { skills: [{ name: 'kfdb-sql-patterns', source: 'wallet' }] } },
        { match: /\/agents\/.*\/mcp$/, method: 'POST', text: 'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"execute_sql"},{"name":"semantic_search"}]}}\n\n' },
        { match: /\/mcp-requirements$/, method: 'GET', json: { agentId: 'notes-qa-abc123', servers: [], totalRequired: 0 } },
        { match: /\/wallet\/agent-secrets\//, method: 'GET', json: { configuredSecrets: ['KFDB_API_KEY'], missingRequired: [], ready: true } },
        { match: /\/agents\/custom\/.*\/kb-tools$/, method: 'GET', json: { kbToolsEnabled: true } },
        { match: /\/agents\/custom\/.*\/reflect$/, method: 'GET', json: { reflectEnabled: false, reflectConfig: { minConfidence: 0.6, autoShare: false, defaultSpace: 'general' }, kbAuthConfigured: true } },
      ]);
      const builder = makeBuilder();
      const result = await builder.verify('notes-qa-abc123');

      expect(result.exists).toBe(true);
      expect(result.skills).toEqual(['kfdb-sql-patterns']);
      expect(result.tools).toEqual(['execute_sql', 'semantic_search']);
      expect(result.secretStatus?.ready).toBe(true);
      expect(result.kbToolsEnabled).toBe(true);
      expect(result.reflect?.kbAuthConfigured).toBe(true);
      expect(calls.some((c) => /\/mcp-requirements$/.test(c.url))).toBe(true);
    });

    it('reports exists:false when the agent is not found, without throwing', async () => {
      routeFetch([
        { match: /\/agents\/custom\/missing$/, method: 'GET', status: 404, text: 'not found' },
        { match: /\/wallet\/skills\/agent\//, method: 'GET', status: 404, text: 'nf' },
        { match: /\/agents\/.*\/mcp$/, method: 'POST', status: 404, text: 'nf' },
        { match: /\/mcp-requirements$/, method: 'GET', status: 404, text: 'nf' },
        { match: /\/wallet\/agent-secrets\//, method: 'GET', status: 404, text: 'nf' },
        { match: /\/kb-tools$/, method: 'GET', status: 404, text: 'nf' },
        { match: /\/reflect$/, method: 'GET', status: 404, text: 'nf' },
      ]);
      const builder = makeBuilder();
      const result = await builder.verify('missing');
      expect(result.exists).toBe(false);
      expect(result.skills).toEqual([]);
      expect(result.tools).toEqual([]);
    });
  });

  describe('constructor', () => {
    it('requires a token, privateKey, or client', () => {
      expect(() => new AgentBuilder({})).toThrow(/token, privateKey, or a pre-built client/);
    });
  });
});
