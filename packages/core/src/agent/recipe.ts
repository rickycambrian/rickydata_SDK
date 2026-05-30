/**
 * Recipe parsing for the Agent Builder.
 *
 * Parses an `agent.md` document — YAML-ish front-matter plus a markdown body —
 * into an {@link AgentSpec}. The format mirrors the agent definition front-matter
 * documented in the create-flow contract (§3): simple `key: value` scalars,
 * comma-separated OR inline/block YAML lists, and a nested `reflect:` block.
 *
 * A full YAML parser is intentionally avoided (no runtime dependency); the
 * contract's front-matter only uses the small subset handled here.
 */

import type { AgentSpec, ReflectConfig } from './types.js';

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export interface ParsedFrontMatter {
  fields: Record<string, unknown>;
  body: string;
}

/** Split an agent.md into its front-matter fields and markdown body. */
export function splitFrontMatter(raw: string): ParsedFrontMatter {
  const match = raw.match(FRONT_MATTER_RE);
  if (!match) {
    // No front-matter — treat the whole document as the body.
    return { fields: {}, body: raw.trim() };
  }
  return { fields: parseFrontMatterBlock(match[1]), body: (match[2] ?? '').trim() };
}

/** Parse the inner YAML-ish block (between the `---` fences). */
export function parseFrontMatterBlock(block: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    // Top-level keys only (no indentation) start a new field.
    if (/^\s/.test(line)) continue;

    const key = line.slice(0, colon).trim();
    const rest = line.slice(colon + 1).trim();

    if (rest === '') {
      // Could be a nested map or a block list. Peek at the indented region.
      const indented: string[] = [];
      while (i < lines.length && (/^\s+\S/.test(lines[i]) || lines[i].trim() === '')) {
        if (lines[i].trim() !== '') indented.push(lines[i]);
        i += 1;
      }
      const blockItems = indented
        .filter((l) => l.trim().startsWith('- '))
        .map((l) => stripQuotes(l.trim().slice(2).trim()));
      if (blockItems.length > 0) {
        fields[key] = blockItems;
      } else if (indented.length > 0) {
        fields[key] = parseFrontMatterBlock(indented.map((l) => l.replace(/^\s{2}/, '')).join('\n'));
      } else {
        fields[key] = '';
      }
      continue;
    }

    fields[key] = parseScalarOrInlineList(rest);
  }

  return fields;
}

function parseScalarOrInlineList(value: string): unknown {
  // Inline YAML list: [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => stripQuotes(v.trim()))
      .filter((v) => v.length > 0);
  }
  return stripQuotes(value);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Coerce a front-matter value into a string[] (comma-separated string or list). */
export function toStringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a full `agent.md` (front-matter + body) into an {@link AgentSpec}.
 *
 * Front-matter keys recognised (per the create-flow contract):
 *   name, description, title, model, category|categories,
 *   mcp_servers, agent_secrets, skills, visibility|public, builtin_tools,
 *   kb_tools, reflect (nested: enabled, minConfidence, autoShare, defaultSpace)
 * The markdown body becomes `systemPrompt`.
 */
export function parseAgentMarkdown(raw: string): AgentSpec {
  const { fields, body } = splitFrontMatter(raw);

  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (!name) {
    throw new Error('agent.md front-matter must declare a non-empty `name`');
  }

  const visibilityRaw = (fields.visibility ?? fields.public) as unknown;
  let visibility: 'private' | 'public' | undefined;
  if (typeof visibilityRaw === 'string') {
    const v = visibilityRaw.trim().toLowerCase();
    if (v === 'public' || v === 'true') visibility = 'public';
    else if (v === 'private' || v === 'false') visibility = 'private';
  } else if (typeof visibilityRaw === 'boolean') {
    visibility = visibilityRaw ? 'public' : 'private';
  }

  const reflectField = fields.reflect as Record<string, unknown> | undefined;
  let reflect: AgentSpec['reflect'];
  if (reflectField && typeof reflectField === 'object') {
    const enabled = toBool(reflectField.enabled);
    const config: Record<string, unknown> = {};
    const minConfidence = toNumber(reflectField.minConfidence);
    const autoShare = toBool(reflectField.autoShare);
    const defaultSpace = reflectField.defaultSpace;
    if (minConfidence !== undefined) config.minConfidence = minConfidence;
    if (autoShare !== undefined) config.autoShare = autoShare;
    if (typeof defaultSpace === 'string' && defaultSpace) config.defaultSpace = defaultSpace;
    reflect = {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(Object.keys(config).length ? { config: config as Partial<ReflectConfig> } : {}),
    };
    if (reflect.enabled === undefined && !reflect.config) reflect = undefined;
  }

  const spec: AgentSpec = {
    name,
    systemPrompt: body,
  };

  if (typeof fields.id === 'string' && fields.id.trim()) spec.id = fields.id.trim();
  if (typeof fields.title === 'string' && fields.title) spec.title = fields.title;
  if (typeof fields.description === 'string' && fields.description) spec.description = fields.description;
  if (typeof fields.model === 'string' && fields.model) spec.model = fields.model;

  const category = fields.category ?? fields.categories;
  if (typeof category === 'string' && category) spec.category = category;
  else if (Array.isArray(category) && category.length) spec.category = String(category[0]);

  const mcpServers = toStringList(fields.mcp_servers ?? fields.mcpServers);
  if (mcpServers.length) spec.mcpServers = mcpServers;

  const builtinTools = toStringList(fields.builtin_tools ?? fields.builtinTools);
  if (builtinTools.length) spec.builtinTools = builtinTools;

  const agentSecrets = toStringList(fields.agent_secrets ?? fields.agentSecrets);
  if (agentSecrets.length) spec.agentSecrets = agentSecrets;

  const skills = toStringList(fields.skills);
  if (skills.length) spec.skills = skills;

  if (visibility) spec.visibility = visibility;

  const kbTools = toBool(fields.kb_tools ?? fields.kbTools);
  if (kbTools !== undefined) spec.kbTools = kbTools;

  if (reflect) spec.reflect = reflect;

  return spec;
}
