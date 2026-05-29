import { describe, it, expect } from 'vitest';
import {
  parseAgentMarkdown,
  splitFrontMatter,
  parseFrontMatterBlock,
  toStringList,
} from '../src/agent/recipe.js';

describe('recipe parsing', () => {
  describe('splitFrontMatter', () => {
    it('splits front-matter from body', () => {
      const { fields, body } = splitFrontMatter('---\nname: foo\n---\nHello body');
      expect(fields.name).toBe('foo');
      expect(body).toBe('Hello body');
    });

    it('treats a document with no front-matter as all body', () => {
      const { fields, body } = splitFrontMatter('Just a prompt, no fences');
      expect(fields).toEqual({});
      expect(body).toBe('Just a prompt, no fences');
    });

    it('handles CRLF line endings', () => {
      const { fields, body } = splitFrontMatter('---\r\nname: foo\r\n---\r\nbody');
      expect(fields.name).toBe('foo');
      expect(body).toBe('body');
    });
  });

  describe('parseFrontMatterBlock', () => {
    it('parses scalars, comma lists, inline lists, and block lists', () => {
      const fields = parseFrontMatterBlock([
        'name: my-agent',
        'model: sonnet',
        'mcp_servers: a, b, c',
        'inline: [x, y, z]',
        'block:',
        '  - one',
        '  - two',
      ].join('\n'));
      expect(fields.name).toBe('my-agent');
      expect(fields.model).toBe('sonnet');
      expect(fields.mcp_servers).toBe('a, b, c');
      expect(fields.inline).toEqual(['x', 'y', 'z']);
      expect(fields.block).toEqual(['one', 'two']);
    });

    it('parses a nested map block (reflect)', () => {
      const fields = parseFrontMatterBlock([
        'reflect:',
        '  enabled: true',
        '  minConfidence: 0.6',
        '  defaultSpace: notes',
      ].join('\n'));
      expect(fields.reflect).toEqual({
        enabled: 'true',
        minConfidence: '0.6',
        defaultSpace: 'notes',
      });
    });

    it('strips quotes from scalar values', () => {
      const fields = parseFrontMatterBlock('description: "a quoted value"');
      expect(fields.description).toBe('a quoted value');
    });

    it('ignores comment lines', () => {
      const fields = parseFrontMatterBlock('# a comment\nname: x');
      expect(fields.name).toBe('x');
      expect(Object.keys(fields)).toEqual(['name']);
    });
  });

  describe('toStringList', () => {
    it('splits comma-separated strings', () => {
      expect(toStringList('a, b ,c')).toEqual(['a', 'b', 'c']);
    });
    it('passes arrays through', () => {
      expect(toStringList(['a', 'b'])).toEqual(['a', 'b']);
    });
    it('returns [] for empty/undefined', () => {
      expect(toStringList(undefined)).toEqual([]);
      expect(toStringList('')).toEqual([]);
    });
  });

  describe('parseAgentMarkdown', () => {
    const doc = [
      '---',
      'name: rickydata-notes-qa',
      'description: Answers questions over your notes.',
      'model: sonnet',
      'public: false',
      'categories: productivity',
      'kb_tools: true',
      'agent_secrets: KFDB_API_KEY',
      'skills: kfdb-schema-map,kfdb-sql-patterns',
      '---',
      '',
      '# rickydata-notes-qa',
      '',
      'You are a notes agent.',
    ].join('\n');

    it('maps the notes-agent front-matter to an AgentSpec', () => {
      const spec = parseAgentMarkdown(doc);
      expect(spec.name).toBe('rickydata-notes-qa');
      expect(spec.description).toBe('Answers questions over your notes.');
      expect(spec.model).toBe('sonnet');
      expect(spec.category).toBe('productivity');
      expect(spec.visibility).toBe('private'); // public: false → private
      expect(spec.kbTools).toBe(true);
      expect(spec.agentSecrets).toEqual(['KFDB_API_KEY']);
      expect(spec.skills).toEqual(['kfdb-schema-map', 'kfdb-sql-patterns']);
      expect(spec.systemPrompt).toContain('# rickydata-notes-qa');
      expect(spec.systemPrompt).toContain('You are a notes agent.');
      expect(spec.systemPrompt).not.toContain('name: rickydata-notes-qa');
    });

    it('throws when name is missing', () => {
      expect(() => parseAgentMarkdown('---\nmodel: sonnet\n---\nbody')).toThrow(/name/);
    });

    it('maps public:true to visibility public', () => {
      const spec = parseAgentMarkdown('---\nname: x\npublic: true\n---\nb');
      expect(spec.visibility).toBe('public');
    });

    it('parses a reflect block into spec.reflect', () => {
      const spec = parseAgentMarkdown([
        '---',
        'name: x',
        'reflect:',
        '  enabled: true',
        '  minConfidence: 0.7',
        '  autoShare: false',
        '  defaultSpace: notes',
        '---',
        'body',
      ].join('\n'));
      expect(spec.reflect).toEqual({
        enabled: true,
        config: { minConfidence: 0.7, autoShare: false, defaultSpace: 'notes' },
      });
    });
  });
});
