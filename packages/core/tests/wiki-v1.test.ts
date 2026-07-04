import { describe, expect, it } from 'vitest';
import {
  WIKI_V1_CONTRACT_VERSION,
  WIKI_V1_NODE_LABELS,
  WIKI_V1_EDGE_TYPES,
  WIKI_V1_NAMESPACE,
  isWikiV1NodeLabel,
  isWikiV1EdgeType,
  assertWikiV1NodeLabel,
  assertWikiV1EdgeType,
  normalizeWikiClaimText,
  sha256Hex,
  deriveWikiPageId,
  deriveWikiClaimId,
  deriveWikiClaimIdV1Legacy,
  deriveWikiRevisionId,
  buildWikiPageWriteOps,
  buildWikiClaimWriteOps,
  buildWikiRevisionWriteOps,
  buildWikiEdgeOp,
} from '../src/kfdb/index.js';

const NOW = '2026-07-03T00:00:00.000Z';

describe('wiki-v1 registry guard', () => {
  it('registers exactly the wiki-v1 vocabulary', () => {
    expect(WIKI_V1_CONTRACT_VERSION).toBe('rickydata.wiki.v1');
    expect([...WIKI_V1_NODE_LABELS]).toEqual(['WikiPage', 'WikiClaim', 'WikiRevision']);
    expect([...WIKI_V1_EDGE_TYPES]).toEqual([
      'HAS_CLAIM',
      'CITES',
      'SUMMARIZES',
      'CONTRADICTS',
      'SUPPORTS',
      'REFINES',
      'ABOUT',
      'SUPERSEDES',
      'VERIFIED_BY',
      'CURRENT_REVISION',
      'REVISION_OF',
    ]);
  });

  it('refuses unregistered labels and edges (anti-fragmentation, L7)', () => {
    expect(isWikiV1NodeLabel('WikiPage')).toBe(true);
    expect(isWikiV1NodeLabel('WikiPages')).toBe(false);
    expect(isWikiV1EdgeType('CITES')).toBe(true);
    expect(isWikiV1EdgeType('MENTIONS')).toBe(false);
    expect(() => assertWikiV1NodeLabel('WikiArticle')).toThrow(/unregistered node label/);
    expect(() => assertWikiV1EdgeType('LINKS_TO')).toThrow(/unregistered edge type/);
  });
});

describe('wiki-v1 id derivation (byte-compatible with rickydata_home)', () => {
  it('uses the HOME namespace, not the repo-execution-graph namespace', () => {
    // WikiPage/WikiClaim ids live beside HomeDecision/Mission Control ids
    // (rickydata_home src/hitl/ids.ts HOME_NAMESPACE) — NOT the memory-v1
    // namespace, and never `\x1f`-delimited.
    expect(WIKI_V1_NAMESPACE).toBe('6f3a1e2c-9b47-5d8a-bc11-7e0f2a9d4c63');
  });

  it('derives the pinned WikiPage id for a real seed slug', () => {
    // uuidv5('WikiPage:edge-id-derivation') in the home namespace — pinned so a
    // template change (delimiter, casing, \x1f) fails loudly here.
    expect(deriveWikiPageId('edge-id-derivation')).toBe('8deef5de-0c03-539b-b509-c7e2b7aec33a');
    expect(deriveWikiPageId('edge-id-derivation')).toBe(deriveWikiPageId('edge-id-derivation'));
  });

  it('normalizes claim text: trim + collapse whitespace, case preserved', () => {
    expect(normalizeWikiClaimText('  The  legacy \n  pipe template works live. ')).toBe(
      'The legacy pipe template works live.',
    );
    // Case is semantic — never folded.
    expect(normalizeWikiClaimText('KFDB requires UUID edge ids')).toBe('KFDB requires UUID edge ids');
  });

  it('derives GLOBAL page-independent WikiClaim ids (v1.1: sha256 hash24 of normalized text)', () => {
    const id = deriveWikiClaimId('The  legacy   pipe template works live.');
    // Same sentence, different whitespace → same claim node (merge).
    expect(deriveWikiClaimId(' The legacy pipe template works live. ')).toBe(id);
    // v1.1: claim identity is page-INDEPENDENT — the id derives from text alone,
    // so the same sentence anywhere in the wiki is ONE node (dedup + rename-safety).
    const hash24 = sha256Hex(normalizeWikiClaimText('The legacy pipe template works live.')).slice(0, 24);
    expect(hash24).toHaveLength(24);
    // Different sentence → different node.
    expect(deriveWikiClaimId('KFDB requires UUID edge ids.')).not.toBe(id);
    // Case is semantic — distinct casing stays distinct.
    expect(deriveWikiClaimId('the legacy pipe template works live.')).not.toBe(id);
  });

  it('freezes the v1.0 page-scoped derivation byte-exact for the migration script', () => {
    // Pinned against the pre-v1.1 deriveWikiClaimId(pageSlug, text) output —
    // scripts/migrate-wiki-v1_1.ts reads legacy nodes by these ids.
    const legacy = deriveWikiClaimIdV1Legacy('edge-id-derivation', 'The  legacy   pipe template works live.');
    expect(legacy).toBe('828c9a94-fa8b-5a71-91d3-ea5f13f6ddd4');
    expect(deriveWikiClaimIdV1Legacy('edge-id-derivation', ' The legacy pipe template works live. ')).toBe(legacy);
    // Legacy ids WERE page-scoped — a different page yields a different id.
    expect(deriveWikiClaimIdV1Legacy('kfdb-write-scope', 'The legacy pipe template works live.')).not.toBe(legacy);
    // And the global v1.1 id differs from the legacy one (migration is a real rewrite).
    expect(deriveWikiClaimId('The legacy pipe template works live.')).not.toBe(legacy);
  });

  it('derives WikiRevision ids from pageSlug + body hash (idempotent re-apply)', () => {
    const body = '# Edge-id derivation\n\nTwo templates exist…';
    const hash = sha256Hex(body);
    const id = deriveWikiRevisionId('edge-id-derivation', hash);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveWikiRevisionId('edge-id-derivation', hash)).toBe(id); // deterministic
    expect(deriveWikiRevisionId('edge-id-derivation', sha256Hex(body + ' '))).not.toBe(id);
    expect(deriveWikiRevisionId('another-page', hash)).not.toBe(id);
    expect(() => deriveWikiRevisionId('edge-id-derivation', 'not-a-hash')).toThrow(/sha256/);
  });

  it('derives CANONICAL concatenated edge ids (no pipe delimiter)', () => {
    const pageId = deriveWikiPageId('edge-id-derivation');
    const claimId = deriveWikiClaimIdV1Legacy('edge-id-derivation', 'The legacy pipe template works live.');
    const op = buildWikiEdgeOp(pageId, 'HAS_CLAIM', claimId, { now: NOW });
    expect(op.operation).toBe('create_edge');
    if (op.operation !== 'create_edge') throw new Error('expected create_edge');
    // uuidv5(`${from}HAS_CLAIM${to}`) — byte-equal to home's canonicalEdgeId.
    expect(op.id).toBe('dd7a9256-8118-5879-a176-59aa63aef1d6');
    expect(op.from).toBe(pageId);
    expect(op.to).toBe(claimId);
    expect(op.edge_type).toBe('HAS_CLAIM');
  });
});

describe('buildWikiPageWriteOps', () => {
  const page = {
    slug: 'edge-id-derivation',
    kind: 'concept' as const,
    title: 'Edge-id derivation',
    bodyMd: '# Edge-id derivation\n\nTwo templates exist…',
    summary: 'How rickydata derives deterministic KFDB edge ids; canonical vs frozen legacy template.',
    compilerVersion: 'manual-seed/1',
  };

  it('builds a merge create_node with the full §3.1 property contract', () => {
    const ops = buildWikiPageWriteOps(page, { now: NOW });
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op).toMatchObject({ operation: 'create_node', label: 'WikiPage', mode: 'merge' });
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.id).toBe(deriveWikiPageId('edge-id-derivation'));
    expect(op.properties).toMatchObject({
      slug: { String: 'edge-id-derivation' },
      kind: { String: 'concept' },
      title: { String: 'Edge-id derivation' },
      body_md: { String: page.bodyMd },
      summary: { String: page.summary },
      status: { String: 'active' },
      valid_from: { String: NOW },
      valid_to: { Null: null },
      superseded_by: { Null: null },
      source_count: { Integer: 0 },
      last_compiled_at: { String: NOW },
      compiler_version: { String: 'manual-seed/1' },
      rickydata_wiki_schema_version: { String: 'v1' },
    });
  });

  it('rejects an invalid kind and an invalid status', () => {
    expect(() => buildWikiPageWriteOps({ ...page, kind: 'note' as never })).toThrow(/kind/);
    expect(() => buildWikiPageWriteOps({ ...page, status: 'archived' as never })).toThrow(/status/);
  });

  it('rejects a summary that is over budget or carries secret-shaped content (L6)', () => {
    expect(() => buildWikiPageWriteOps({ ...page, summary: 'x'.repeat(701) })).toThrow(/summary/);
    expect(() =>
      buildWikiPageWriteOps({ ...page, summary: 'the key is 0x' + 'ab'.repeat(32) }),
    ).toThrow(/secret/i);
    expect(() => buildWikiPageWriteOps({ ...page, summary: 'token ghp_' + 'A1b2C3d4'.repeat(5) })).toThrow(
      /secret/i,
    );
  });

  it('omits sensitivity/embedding_allowed when absent, writes them when provided (v1.1)', () => {
    const bare = buildWikiPageWriteOps(page, { now: NOW })[0]!;
    if (bare.operation !== 'create_node') throw new Error('expected create_node');
    expect(bare.properties).not.toHaveProperty('sensitivity');
    expect(bare.properties).not.toHaveProperty('embedding_allowed');

    const full = buildWikiPageWriteOps(
      { ...page, sensitivity: 'restricted', embeddingAllowed: false },
      { now: NOW },
    )[0]!;
    if (full.operation !== 'create_node') throw new Error('expected create_node');
    expect(full.properties).toMatchObject({
      sensitivity: { String: 'restricted' },
      embedding_allowed: { Boolean: false },
    });
    expect(() => buildWikiPageWriteOps({ ...page, sensitivity: 'public' as never })).toThrow(/sensitivity/);
  });
});

describe('buildWikiClaimWriteOps (confidence rubric, L4)', () => {
  const claim = {
    pageSlug: 'edge-id-derivation',
    text: 'The legacy pipe template works live.',
    confidenceTier: 'EXTRACTED' as const,
    confidenceScore: 1.0,
    sourceRef: 'commit:8132a5c',
  };

  it('builds the claim node with the §3.2 contract and stamps timestamps', () => {
    const ops = buildWikiClaimWriteOps(claim, { now: NOW });
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.label).toBe('WikiClaim');
    expect(op.id).toBe(deriveWikiClaimId(claim.text));
    expect(op.properties).toMatchObject({
      page_slug: { String: 'edge-id-derivation' },
      text: { String: 'The legacy pipe template works live.' },
      confidence_tier: { String: 'EXTRACTED' },
      confidence_score: { Float: 1.0 },
      status: { String: 'active' },
      fingerprint_kind: { String: 'none' },
      staleness_fingerprint: { Null: null },
      source_ref: { String: 'commit:8132a5c' },
      created_at: { String: NOW },
      updated_at: { String: NOW },
      rickydata_wiki_schema_version: { String: 'v1' },
    });
  });

  it('stores the NORMALIZED text so re-ingest merges instead of duplicating', () => {
    const ops = buildWikiClaimWriteOps({ ...claim, text: '  The  legacy   pipe template works live. ' }, { now: NOW });
    const op = ops[0]!;
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.properties['text']).toEqual({ String: 'The legacy pipe template works live.' });
    expect(op.id).toBe(deriveWikiClaimId(claim.text));
  });

  it('omits the v1.1 props entirely when not provided (partial-merge-preserve)', () => {
    const ops = buildWikiClaimWriteOps(claim, { now: NOW });
    const op = ops[0]!;
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.properties).not.toHaveProperty('quote_excerpt');
    expect(op.properties).not.toHaveProperty('source_digest');
    expect(op.properties).not.toHaveProperty('sensitivity');
  });

  it('writes quote_excerpt/source_digest/sensitivity when provided (v1.1 support-lite)', () => {
    const digest = 'sha256:' + 'ab'.repeat(32);
    const ops = buildWikiClaimWriteOps(
      { ...claim, quoteExcerpt: 'the legacy pipe template is frozen to its deployed modules', sourceDigest: digest, sensitivity: 'restricted' },
      { now: NOW },
    );
    const op = ops[0]!;
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.properties).toMatchObject({
      quote_excerpt: { String: 'the legacy pipe template is frozen to its deployed modules' },
      source_digest: { String: digest },
      sensitivity: { String: 'restricted' },
    });
  });

  it('rejects an over-cap quote_excerpt, malformed source_digest, and bogus sensitivity', () => {
    expect(() => buildWikiClaimWriteOps({ ...claim, quoteExcerpt: 'x'.repeat(301) })).toThrow(/quote_excerpt/);
    expect(() => buildWikiClaimWriteOps({ ...claim, quoteExcerpt: 'x'.repeat(300) })).not.toThrow();
    expect(() => buildWikiClaimWriteOps({ ...claim, sourceDigest: 'ab'.repeat(32) })).toThrow(/source_digest/);
    expect(() => buildWikiClaimWriteOps({ ...claim, sourceDigest: 'sha256:zz' })).toThrow(/source_digest/);
    expect(() => buildWikiClaimWriteOps({ ...claim, sensitivity: 'secret' as never })).toThrow(/sensitivity/);
  });

  it('enforces the discrete rubric: EXTRACTED must be 1.0', () => {
    expect(() => buildWikiClaimWriteOps({ ...claim, confidenceScore: 0.9 })).toThrow(/EXTRACTED/);
  });

  it('enforces the discrete rubric: INFERRED must be one of the five values (never 0.5)', () => {
    for (const ok of [0.95, 0.85, 0.75, 0.65, 0.55]) {
      expect(() =>
        buildWikiClaimWriteOps({ ...claim, confidenceTier: 'INFERRED', confidenceScore: ok }),
      ).not.toThrow();
    }
    expect(() =>
      buildWikiClaimWriteOps({ ...claim, confidenceTier: 'INFERRED', confidenceScore: 0.5 }),
    ).toThrow(/INFERRED/);
    expect(() =>
      buildWikiClaimWriteOps({ ...claim, confidenceTier: 'INFERRED', confidenceScore: 0.8 }),
    ).toThrow(/INFERRED/);
  });

  it('enforces the discrete rubric: AMBIGUOUS must sit in [0.1, 0.3]', () => {
    expect(() =>
      buildWikiClaimWriteOps({ ...claim, confidenceTier: 'AMBIGUOUS', confidenceScore: 0.2 }),
    ).not.toThrow();
    expect(() =>
      buildWikiClaimWriteOps({ ...claim, confidenceTier: 'AMBIGUOUS', confidenceScore: 0.4 }),
    ).toThrow(/AMBIGUOUS/);
  });

  it('requires a non-none fingerprint_kind when a fingerprint is present, and vice versa', () => {
    expect(() =>
      buildWikiClaimWriteOps({ ...claim, stalenessFingerprint: '8132a5c' }),
    ).toThrow(/fingerprint_kind/);
    expect(() =>
      buildWikiClaimWriteOps({ ...claim, fingerprintKind: 'commit' }),
    ).toThrow(/staleness_fingerprint/);
    const ops = buildWikiClaimWriteOps(
      { ...claim, stalenessFingerprint: '8132a5c', fingerprintKind: 'commit' },
      { now: NOW },
    );
    const op = ops[0]!;
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.properties).toMatchObject({
      staleness_fingerprint: { String: '8132a5c' },
      fingerprint_kind: { String: 'commit' },
    });
  });

  it('requires source_ref (provenance or it did not happen)', () => {
    expect(() => buildWikiClaimWriteOps({ ...claim, sourceRef: '' })).toThrow(/source_ref/);
  });
});

describe('buildWikiRevisionWriteOps (v1.1 immutable snapshots, §3.5)', () => {
  const body = '# Edge-id derivation\n\nTwo templates exist…';
  const revision = {
    pageSlug: 'edge-id-derivation',
    bodyMd: body,
    bodySha256: sha256Hex(body),
    summary: 'How rickydata derives deterministic KFDB edge ids; canonical vs frozen legacy template.',
    createdBy: 'manual-seed/1',
  };

  it('builds a merge create_node whose id IS the content hash (idempotent re-apply)', () => {
    const ops = buildWikiRevisionWriteOps(revision, { now: NOW });
    expect(ops).toHaveLength(1);
    const op = ops[0]!;
    expect(op).toMatchObject({ operation: 'create_node', label: 'WikiRevision', mode: 'merge' });
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.id).toBe(deriveWikiRevisionId('edge-id-derivation', sha256Hex(body)));
    expect(op.properties).toMatchObject({
      page_slug: { String: 'edge-id-derivation' },
      body_md: { String: body },
      body_sha256: { String: sha256Hex(body) },
      summary: { String: revision.summary },
      created_at: { String: NOW },
      created_by: { String: 'manual-seed/1' },
      compiler_run_id: { Null: null },
      diff_ref: { Null: null },
      rickydata_wiki_schema_version: { String: 'v1' },
    });
    // Same body re-applied → same op id (the immutability law needs no update path).
    expect((buildWikiRevisionWriteOps(revision, { now: NOW })[0] as { id: string }).id).toBe(op.id);
  });

  it('stamps compiler provenance when compiler-applied', () => {
    const op = buildWikiRevisionWriteOps(
      { ...revision, createdBy: 'wiki-compiler/0.1.0', compilerRunId: 'run-123', diffRef: 'wiki-update:edge-id-derivation:run-123' },
      { now: NOW },
    )[0]!;
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.properties).toMatchObject({
      created_by: { String: 'wiki-compiler/0.1.0' },
      compiler_run_id: { String: 'run-123' },
      diff_ref: { String: 'wiki-update:edge-id-derivation:run-123' },
    });
  });

  it('THROWS when body_sha256 does not match sha256(body_md) — never a lying snapshot', () => {
    expect(() =>
      buildWikiRevisionWriteOps({ ...revision, bodySha256: sha256Hex(body + ' tampered') }),
    ).toThrow(/body_sha256 mismatch/);
    expect(() => buildWikiRevisionWriteOps({ ...revision, bodySha256: 'nope' })).toThrow(/mismatch/);
  });

  it('requires slug, body, summary and created_by; keeps the summary secret-free', () => {
    expect(() => buildWikiRevisionWriteOps({ ...revision, pageSlug: ' ' })).toThrow(/page_slug/);
    expect(() => buildWikiRevisionWriteOps({ ...revision, bodyMd: ' ', bodySha256: sha256Hex(' ') })).toThrow(/body_md/);
    expect(() => buildWikiRevisionWriteOps({ ...revision, summary: ' ' })).toThrow(/summary/);
    expect(() => buildWikiRevisionWriteOps({ ...revision, createdBy: '' })).toThrow(/created_by/);
    expect(() =>
      buildWikiRevisionWriteOps({ ...revision, summary: 'the key is 0x' + 'ab'.repeat(32) }),
    ).toThrow(/secret/i);
  });
});

describe('buildWikiEdgeOp', () => {
  it('refuses unregistered edge types and empty endpoints', () => {
    const a = deriveWikiPageId('a-page');
    const b = deriveWikiPageId('b-page');
    expect(() => buildWikiEdgeOp(a, 'LINKS_TO' as never, b)).toThrow(/unregistered edge type/);
    expect(() => buildWikiEdgeOp('', 'REFINES', b)).toThrow(/endpoints/);
  });

  it('stamps created_at + schema version on the edge', () => {
    const op = buildWikiEdgeOp(deriveWikiPageId('a-page'), 'REFINES', deriveWikiPageId('b-page'), {
      now: NOW,
    });
    if (op.operation !== 'create_edge') throw new Error('expected create_edge');
    expect(op.properties).toMatchObject({
      created_at: { String: NOW },
      rickydata_wiki_schema_version: { String: 'v1' },
    });
  });
});

describe('AKC label registry + ContextPack log (SPEC-001 §3, SPEC-003 §5)', async () => {
  const { AKC_PRIVATE_LABELS, assertAkcPrivateLabel, deriveContextPackId, buildContextPackLogOp } =
    await import('../src/kfdb/index.js');

  it('registers all program labels and guards the rest', () => {
    expect(AKC_PRIVATE_LABELS).toEqual([
      'WikiPage',
      'WikiClaim',
      'WikiRevision',
      'RickydataContextPack',
      'RickydataReflectSnapshot',
      'RickydataCanvasGateReport',
    ]);
    expect(() => assertAkcPrivateLabel('RickydataContextPack')).not.toThrow();
    expect(() => assertAkcPrivateLabel('HomeDecision')).toThrow(/registry/);
  });

  it('derives byte-stable context-pack ids in the HOME namespace', () => {
    // Pinned: uuidv5('context-pack:task:akc-p3-wiki-contract:2026-07-03T00:00:00.000Z', HOME ns).
    const id = deriveContextPackId('task', 'akc-p3-wiki-contract', NOW);
    expect(id).toBe(deriveContextPackId('task', 'akc-p3-wiki-contract', NOW)); // deterministic
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveContextPackId('surface', 'plan', NOW)).not.toBe(id);
  });

  it('builds a merge-mode log node with JSON-stringified accounting', () => {
    const op = buildContextPackLogOp({
      anchorKind: 'task',
      anchorKey: 'akc-p3-wiki-contract',
      compiledAt: NOW,
      reproducibilityHash: 'a'.repeat(64),
      tokenEstimate: 1234.6,
      consumer: 'voice-guide',
      sectionCounts: { wiki: 3, lessons: 2 },
      selectedItems: [
        { section: 'wiki', id: 'edge-id-derivation', contentHash: 'abc123def456', tokenEstimate: 320 },
      ],
      omitted: [{ section: 'lessons', count: 1, reason: 'budget' }],
    });
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.label).toBe('RickydataContextPack');
    expect(op.mode).toBe('merge');
    expect(op.id).toBe(deriveContextPackId('task', 'akc-p3-wiki-contract', NOW));
    expect(op.properties).toMatchObject({
      anchor_kind: { String: 'task' },
      token_estimate: { Integer: 1235 },
      section_counts_json: { String: '{"wiki":3,"lessons":2}' },
      schema_version: { String: 'context-pack/v1' },
    });
  });

  it('round-trips the v1.1 selected-items manifest as snake_case wire JSON (SPEC-003 §5)', () => {
    const op = buildContextPackLogOp({
      anchorKind: 'surface',
      anchorKey: 'plan',
      compiledAt: NOW,
      reproducibilityHash: 'b'.repeat(64),
      tokenEstimate: 900,
      consumer: 'plugin',
      sectionCounts: { wiki: 2 },
      selectedItems: [
        { section: 'wiki', id: 'edge-id-derivation', contentHash: 'abc123def456', rankReason: 'verified-first', tokenEstimate: 320 },
        { section: 'decisions', id: 'canvas-approval:r1:a1', contentHash: '0011aabbccdd', tokenEstimate: 80 },
      ],
      omitted: [
        { section: 'wiki', count: 3, reason: 'budget' },
        { section: 'wiki', id: 'kfdb-write-scope', reason: 'budget' }, // high-rank omission identity
      ],
    });
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    const selected = JSON.parse((op.properties['selected_items_json'] as { String: string }).String);
    expect(selected).toEqual([
      { section: 'wiki', id: 'edge-id-derivation', content_hash: 'abc123def456', rank_reason: 'verified-first', token_estimate: 320 },
      { section: 'decisions', id: 'canvas-approval:r1:a1', content_hash: '0011aabbccdd', token_estimate: 80 },
    ]);
    const omitted = JSON.parse((op.properties['omitted_json'] as { String: string }).String);
    expect(omitted).toEqual([
      { section: 'wiki', count: 3, reason: 'budget' },
      { section: 'wiki', id: 'kfdb-write-scope', reason: 'budget' },
    ]);
  });

  it('rejects a malformed hash, empty anchor, and an unaccounted selected item', () => {
    const base = {
      anchorKind: 'task',
      anchorKey: 'x',
      compiledAt: NOW,
      reproducibilityHash: 'a'.repeat(64),
      tokenEstimate: 0,
      consumer: 'plugin',
      sectionCounts: {},
      selectedItems: [],
      omitted: [],
    };
    expect(() => buildContextPackLogOp({ ...base, reproducibilityHash: 'nope' })).toThrow(/sha256/);
    expect(() => buildContextPackLogOp({ ...base, anchorKey: ' ' })).toThrow(/anchor/);
    expect(() =>
      buildContextPackLogOp({
        ...base,
        selectedItems: [{ section: 'wiki', id: ' ', contentHash: 'abc123def456', tokenEstimate: 1 }],
      }),
    ).toThrow(/selected item/);
  });
});
