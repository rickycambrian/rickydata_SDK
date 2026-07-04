/**
 * kfdb/wiki-v1.ts — the `rickydata.wiki.v1` writer library + label-registry guard.
 *
 * The LLM Wiki contract (rickydata_home docs/specs/SPEC-002-llm-wiki.md): the
 * persistent, compounding knowledge artifact for the rickydata stack. Three
 * node labels (WikiPage, WikiClaim, WikiRevision — v1.1), eleven edge types,
 * PRIVATE scope only, merge-mode writes, type-wrapped values. Design laws
 * enforced here at build time:
 *
 *   - L4 provenance: every claim carries the confidence triad
 *     (EXTRACTED 1.0 | INFERRED ∈ {0.95,0.85,0.75,0.65,0.55} | AMBIGUOUS ∈ [0.1,0.3])
 *     and a non-empty source_ref. The discrete INFERRED values are graphify's
 *     production finding verbatim — models collapse continuous ranges to a
 *     bimodal 0.5/0.85, so 0.5 is a hard error, not a default.
 *   - L6 secret-free summaries: `summary` is the semantic-retrieval surface and
 *     is embedded (vectors are NOT encrypted at rest) — the builder rejects
 *     obvious secret shapes and over-budget summaries.
 *   - L7 single-writer: assertWikiV1NodeLabel/assertWikiV1EdgeType throw on any
 *     label outside the v1 set (mirror of memory-v1's anti-fragmentation guard).
 *
 * IDS: uuidv5 in rickydata_home's HOME namespace (6f3a1e2c-…, the same namespace
 * as HomeDecision/Mission Control ids) with plain `:`-joined templates — NOT the
 * repo-execution-graph namespace, and never `\x1f` delimiters. Edge ids use the
 * CANONICAL concatenated template `${from}${type}${to}` (rickydata_home
 * src/kfdb/edge-ids.ts — the legacy pipe template is frozen to its deployed
 * modules and must not spread here).
 */
import { createHash } from 'node:crypto';
import type { RickydataGraphPrimitiveValue, RickydataGraphWriteOperation } from './rickydata-graph.js';

/** The wiki contract version. Nodes carry the short form in `rickydata_wiki_schema_version`. */
export const WIKI_V1_CONTRACT_VERSION = 'rickydata.wiki.v1';

/** The literal stamped on every node/edge (`rickydata_wiki_schema_version`). */
export const WIKI_V1_SCHEMA_STAMP = 'v1';

/**
 * rickydata_home's HOME namespace (src/hitl/ids.ts HOME_NAMESPACE). Wiki ids are
 * cockpit ids — they live beside HomeDecision and Mission Control ids so the two
 * codebases derive byte-identical node ids from the same slug.
 */
export const WIKI_V1_NAMESPACE = '6f3a1e2c-9b47-5d8a-bc11-7e0f2a9d4c63';

export const WIKI_V1_NODE_LABELS = ['WikiPage', 'WikiClaim', 'WikiRevision'] as const;

export const WIKI_V1_EDGE_TYPES = [
  'HAS_CLAIM', // WikiPage → WikiClaim (ownership)
  'CITES', // WikiClaim → source node (cross-scope best-effort; source_ref is the reliable record)
  'SUMMARIZES', // WikiPage → source node (page-level provenance)
  'CONTRADICTS', // WikiClaim → WikiClaim (stored one direction; symmetric on read)
  'SUPPORTS', // WikiClaim → WikiClaim (corroboration)
  'REFINES', // WikiPage → WikiPage (narrower refines broader)
  'ABOUT', // WikiPage → Project|Feature|UseCase|RickydataProductEntity|RoadmapItem
  'SUPERSEDES', // WikiPage(new) → WikiPage(old) · WikiRevision(new) → WikiRevision(old) (v1.1 revision chain)
  'VERIFIED_BY', // WikiClaim → EvidenceRecord|BenchmarkRunProof (Phase 8)
  'CURRENT_REVISION', // WikiPage → WikiRevision (v1.1 — exactly one per live page; re-pointed atomically on apply)
  'REVISION_OF', // WikiRevision → WikiPage (v1.1 — every revision back-links its page)
] as const;

export type WikiV1NodeLabel = (typeof WIKI_V1_NODE_LABELS)[number];
export type WikiV1EdgeType = (typeof WIKI_V1_EDGE_TYPES)[number];

export const WIKI_PAGE_KINDS = ['entity', 'concept', 'subsystem', 'contradiction', 'synthesis'] as const;
export type WikiPageKind = (typeof WIKI_PAGE_KINDS)[number];

export const WIKI_PAGE_STATUSES = ['draft', 'active', 'stale', 'superseded'] as const;
export type WikiPageStatus = (typeof WIKI_PAGE_STATUSES)[number];

export const WIKI_CLAIM_STATUSES = ['active', 'contested', 'retracted'] as const;
export type WikiClaimStatus = (typeof WIKI_CLAIM_STATUSES)[number];

export const WIKI_CONFIDENCE_TIERS = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'] as const;
export type WikiConfidenceTier = (typeof WIKI_CONFIDENCE_TIERS)[number];

/** The only legal INFERRED scores — a forced discrete choice (see header). */
export const WIKI_INFERRED_SCORES = [0.95, 0.85, 0.75, 0.65, 0.55] as const;

export const WIKI_FINGERPRINT_KINDS = ['commit', 'content-hash', 'none'] as const;
export type WikiFingerprintKind = (typeof WIKI_FINGERPRINT_KINDS)[number];

/** Soft target ≤ ~600 chars; hard error above 700 (the retrieval surface must stay a summary). */
export const WIKI_SUMMARY_MAX_CHARS = 700;

/** v1.1 sensitivity-lite (SPEC-002 §13.4): `internal` (default) | `restricted`. */
export const WIKI_SENSITIVITIES = ['internal', 'restricted'] as const;
export type WikiSensitivity = (typeof WIKI_SENSITIVITIES)[number];

/** v1.1 support-lite (SPEC-002 §3.2): quote_excerpt is a verbatim excerpt, hard cap 300 chars. */
export const WIKI_QUOTE_EXCERPT_MAX_CHARS = 300;

// ---------------------------------------------------------------------------
// The guard (L7)
// ---------------------------------------------------------------------------

export function isWikiV1NodeLabel(label: string): label is WikiV1NodeLabel {
  return (WIKI_V1_NODE_LABELS as readonly string[]).includes(label);
}

export function isWikiV1EdgeType(edgeType: string): edgeType is WikiV1EdgeType {
  return (WIKI_V1_EDGE_TYPES as readonly string[]).includes(edgeType);
}

export function assertWikiV1NodeLabel(label: string): asserts label is WikiV1NodeLabel {
  if (!isWikiV1NodeLabel(label)) {
    throw new Error(
      `[wiki-v1] refusing to write unregistered node label "${label}". ` +
        `Registered labels: ${WIKI_V1_NODE_LABELS.join(', ')}. ` +
        `Extend SPEC-002 + this registry before writing — never a second structure for an existing concept.`,
    );
  }
}

export function assertWikiV1EdgeType(edgeType: string): asserts edgeType is WikiV1EdgeType {
  if (!isWikiV1EdgeType(edgeType)) {
    throw new Error(
      `[wiki-v1] refusing to write unregistered edge type "${edgeType}". ` +
        `Registered edge types: ${WIKI_V1_EDGE_TYPES.join(', ')}.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Id derivation
// ---------------------------------------------------------------------------

/** RFC 4122 v5 (SHA-1) UUID in the wiki (home) namespace. */
function uuidv5(name: string, namespace = WIKI_V1_NAMESPACE): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error('[wiki-v1] invalid UUID namespace');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  const b = new Uint8Array(hash.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h
    .slice(8, 10)
    .join('')}-${h.slice(10, 16).join('')}`;
}

/**
 * Claim-text normalization: trim + collapse internal whitespace runs to single
 * spaces. Case is PRESERVED (distinct casing can be semantically distinct).
 * The same sentence anywhere in the wiki always merges to one node (v1.1).
 */
export function normalizeWikiClaimText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** sha256 of `text` as lowercase hex (the revision identity + digest helper). */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function deriveWikiPageId(slug: string): string {
  const s = slug.trim();
  if (!s) throw new Error('[wiki-v1] page slug must not be empty');
  return uuidv5(`WikiPage:${s}`);
}

/**
 * v1.1 GLOBAL claim id (SPEC-002 §3.2): uuidv5(`WikiClaim:<hash24>`) where
 * hash24 = first 24 hex chars of sha256 over the NORMALIZED claim text. Claim
 * identity is page-INDEPENDENT — the same sentence anywhere in the wiki is ONE
 * node; page membership lives on HAS_CLAIM edges. Rename-safety: superseding
 * or renaming a page re-links HAS_CLAIM without changing claim ids, so
 * VERIFIED_BY/CONTRADICTS/SUPPORTS history survives renames.
 */
export function deriveWikiClaimId(text: string): string {
  const normalized = normalizeWikiClaimText(text);
  if (!normalized) throw new Error('[wiki-v1] claim text must not be empty');
  const hash24 = sha256Hex(normalized).slice(0, 24);
  return uuidv5(`WikiClaim:${hash24}`);
}

/**
 * FROZEN v1.0 page-scoped claim derivation — migration-script use ONLY
 * (scripts/migrate-wiki-v1_1.ts reads legacy nodes by this id to rewrite them
 * onto the v1.1 global ids). Never call from a write path.
 */
export function deriveWikiClaimIdV1Legacy(pageSlug: string, text: string): string {
  const slug = pageSlug.trim();
  if (!slug) throw new Error('[wiki-v1] page slug must not be empty');
  const normalized = normalizeWikiClaimText(text);
  if (!normalized) throw new Error('[wiki-v1] claim text must not be empty');
  const hash12 = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 12);
  return uuidv5(`WikiClaim:${slug}:${hash12}`);
}

/**
 * v1.1 WikiRevision id (SPEC-002 §3.5): uuidv5(`WikiRevision:<pageSlug>:<bodySha256>`).
 * Identical re-apply of the same body merges to the same node (idempotent no-op).
 */
export function deriveWikiRevisionId(pageSlug: string, bodySha256: string): string {
  const slug = pageSlug.trim();
  if (!slug) throw new Error('[wiki-v1] page slug must not be empty');
  const hash = bodySha256.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('[wiki-v1] revision body_sha256 must be a sha256 hex string');
  }
  return uuidv5(`WikiRevision:${slug}:${hash}`);
}

/** Canonical concatenated edge id — byte-equal to home's canonicalEdgeId. */
export function deriveWikiEdgeId(fromId: string, type: WikiV1EdgeType, toId: string): string {
  return uuidv5(`${fromId}${type}${toId}`);
}

// ---------------------------------------------------------------------------
// Write builders
// ---------------------------------------------------------------------------

function s(v: string): RickydataGraphPrimitiveValue {
  return { String: v };
}
function nul(): RickydataGraphPrimitiveValue {
  return { Null: null };
}

/**
 * Secret shapes that must never reach the unencrypted retrieval surface (L6).
 * Deliberately conservative — the Phase-5 compiler gate adds a fuller lint.
 */
const SUMMARY_SECRET_PATTERNS: RegExp[] = [
  /0x[0-9a-fA-F]{64}/, // raw 32-byte hex (private keys, derived keys)
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI/Anthropic-style API keys
  /\bghp_[A-Za-z0-9]{20,}/, // GitHub PATs
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key ids
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, // JWTs
];

function assertSecretFreeSummary(summary: string): void {
  if (summary.length > WIKI_SUMMARY_MAX_CHARS) {
    throw new Error(
      `[wiki-v1] summary is ${summary.length} chars — the retrieval surface targets ≤600 (hard cap ${WIKI_SUMMARY_MAX_CHARS}). Move detail into body_md.`,
    );
  }
  for (const pattern of SUMMARY_SECRET_PATTERNS) {
    if (pattern.test(summary)) {
      throw new Error(
        '[wiki-v1] summary matches a secret shape (L6: summaries are embedded and vectors are not encrypted — never put keys/tokens in summary).',
      );
    }
  }
}

function assertWikiSensitivity(sensitivity: string): asserts sensitivity is WikiSensitivity {
  if (!(WIKI_SENSITIVITIES as readonly string[]).includes(sensitivity)) {
    throw new Error(
      `[wiki-v1] invalid sensitivity "${sensitivity}" (expected ${WIKI_SENSITIVITIES.join(' | ')})`,
    );
  }
}

/** v1.1 source_digest shape: `sha256:<hex>` over the full normalized source-atom text. */
function assertSourceDigestShape(sourceDigest: string): void {
  if (!/^sha256:[0-9a-f]{64}$/.test(sourceDigest)) {
    throw new Error(
      `[wiki-v1] source_digest must be \`sha256:<64 lowercase hex>\` (got "${sourceDigest}").`,
    );
  }
}

export interface WikiPageInput {
  /** Identity key — stable kebab slug for the page's life. */
  slug: string;
  kind: WikiPageKind;
  title: string;
  /** Canonical markdown artifact; may contain [[wikilinks]]. S2D-encrypted at rest. */
  bodyMd: string;
  /** ≤ ~600 chars, secret-free, embedded for retrieval (L6). */
  summary: string;
  /** Defaults to 'active' (hand-seed / applied-diff both write live pages). */
  status?: WikiPageStatus;
  /** ISO-8601; defaults to now. */
  validFrom?: string;
  /** ISO-8601 | null; set when superseded. */
  validTo?: string | null;
  /** Slug of the successor page. */
  supersededBy?: string | null;
  /** Count of SUMMARIZES/CITES sources feeding this page. Defaults 0. */
  sourceCount?: number;
  /** ISO-8601 of the last compiler pass; defaults to now. */
  lastCompiledAt?: string;
  /** e.g. `wiki-compiler/0.1.0`, `manual-seed/1`. */
  compilerVersion: string;
  /**
   * v1.1 (§13.4): `restricted` pages are excluded from packs whose consumer
   * crosses the trust boundary. Written ONLY when provided (partial-merge-
   * preserve: absent means the live prop is untouched).
   */
  sensitivity?: WikiSensitivity;
  /**
   * v1.1 (§13.4): when `false` the summary is NEVER embedded (the writer
   * refuses, not just skips). Written ONLY when provided.
   */
  embeddingAllowed?: boolean;
}

export function buildWikiPageWriteOps(
  page: WikiPageInput,
  opts: { now?: string } = {},
): RickydataGraphWriteOperation[] {
  assertWikiV1NodeLabel('WikiPage');
  const now = opts.now ?? new Date().toISOString();
  const slug = page.slug.trim();
  if (!slug) throw new Error('[wiki-v1] page slug must not be empty');
  if (!(WIKI_PAGE_KINDS as readonly string[]).includes(page.kind)) {
    throw new Error(`[wiki-v1] invalid page kind "${page.kind}" (expected ${WIKI_PAGE_KINDS.join(' | ')})`);
  }
  const status = page.status ?? 'active';
  if (!(WIKI_PAGE_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`[wiki-v1] invalid page status "${status}" (expected ${WIKI_PAGE_STATUSES.join(' | ')})`);
  }
  if (!page.title.trim()) throw new Error('[wiki-v1] page title must not be empty');
  if (!page.bodyMd.trim()) throw new Error('[wiki-v1] page body_md must not be empty');
  if (!page.summary.trim()) throw new Error('[wiki-v1] page summary must not be empty');
  assertSecretFreeSummary(page.summary);

  const properties: Record<string, RickydataGraphPrimitiveValue> = {
    slug: s(slug),
    kind: s(page.kind),
    title: s(page.title),
    body_md: s(page.bodyMd),
    summary: s(page.summary),
    status: s(status),
    valid_from: s(page.validFrom ?? now),
    valid_to: page.validTo == null ? nul() : s(page.validTo),
    superseded_by: page.supersededBy == null ? nul() : s(page.supersededBy),
    source_count: { Integer: Math.trunc(page.sourceCount ?? 0) },
    last_compiled_at: s(page.lastCompiledAt ?? now),
    compiler_version: s(page.compilerVersion),
    rickydata_wiki_schema_version: s(WIKI_V1_SCHEMA_STAMP),
  };
  // v1.1 fields ride ONLY when provided — merge-mode leaves absent props untouched.
  if (page.sensitivity !== undefined) {
    assertWikiSensitivity(page.sensitivity);
    properties['sensitivity'] = s(page.sensitivity);
  }
  if (page.embeddingAllowed !== undefined) {
    properties['embedding_allowed'] = { Boolean: page.embeddingAllowed };
  }

  return [{ operation: 'create_node', id: deriveWikiPageId(slug), label: 'WikiPage', properties, mode: 'merge' }];
}

export interface WikiClaimInput {
  pageSlug: string;
  /** One self-contained factual statement (normalized before hashing/storing). */
  text: string;
  confidenceTier: WikiConfidenceTier;
  confidenceScore: number;
  status?: WikiClaimStatus;
  /** Commit sha or `sha256:<hex>` content hash of the cited source span. */
  stalenessFingerprint?: string | null;
  /** Required non-'none' when a fingerprint is present. Defaults 'none'. */
  fingerprintKind?: WikiFingerprintKind;
  /** Human-readable provenance fallback (e.g. `HomeDecision:<id>`, `commit:<sha>`). REQUIRED (L4). */
  sourceRef: string;
  createdAt?: string;
  updatedAt?: string;
  /**
   * v1.1 support-lite (§3.2/§13.3): ≤300-char VERBATIM excerpt from the cited
   * source that grounds the claim. Written ONLY when provided.
   */
  quoteExcerpt?: string;
  /**
   * v1.1: `sha256:<hex>` of the full normalized source-atom text the claim was
   * extracted from (computed by the compiler, never LLM-self-reported).
   * Written ONLY when provided.
   */
  sourceDigest?: string;
  /** v1.1 (§13.4). Written ONLY when provided. */
  sensitivity?: WikiSensitivity;
}

function assertConfidenceRubric(tier: WikiConfidenceTier, score: number): void {
  switch (tier) {
    case 'EXTRACTED':
      if (score !== 1.0) {
        throw new Error(`[wiki-v1] EXTRACTED claims always score 1.0 (got ${score}).`);
      }
      return;
    case 'INFERRED':
      if (!(WIKI_INFERRED_SCORES as readonly number[]).includes(score)) {
        throw new Error(
          `[wiki-v1] INFERRED claims must score exactly one of ${WIKI_INFERRED_SCORES.join(', ')} (got ${score}; ` +
            `0.5 is banned — pick a discrete value or downgrade to AMBIGUOUS).`,
        );
      }
      return;
    case 'AMBIGUOUS':
      if (score < 0.1 || score > 0.3) {
        throw new Error(`[wiki-v1] AMBIGUOUS claims score within [0.1, 0.3] (got ${score}).`);
      }
      return;
    default:
      throw new Error(`[wiki-v1] invalid confidence tier "${tier as string}"`);
  }
}

export function buildWikiClaimWriteOps(
  claim: WikiClaimInput,
  opts: { now?: string } = {},
): RickydataGraphWriteOperation[] {
  assertWikiV1NodeLabel('WikiClaim');
  const now = opts.now ?? new Date().toISOString();
  const pageSlug = claim.pageSlug.trim();
  if (!pageSlug) throw new Error('[wiki-v1] claim page_slug must not be empty');
  const text = normalizeWikiClaimText(claim.text);
  if (!text) throw new Error('[wiki-v1] claim text must not be empty');
  if (!(WIKI_CONFIDENCE_TIERS as readonly string[]).includes(claim.confidenceTier)) {
    throw new Error(`[wiki-v1] invalid confidence tier "${claim.confidenceTier}"`);
  }
  assertConfidenceRubric(claim.confidenceTier, claim.confidenceScore);
  const status = claim.status ?? 'active';
  if (!(WIKI_CLAIM_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`[wiki-v1] invalid claim status "${status}"`);
  }
  if (!claim.sourceRef?.trim()) {
    throw new Error('[wiki-v1] claim source_ref is required (L4: provenance or it did not happen).');
  }
  const fingerprint = claim.stalenessFingerprint ?? null;
  const fingerprintKind = claim.fingerprintKind ?? 'none';
  if (!(WIKI_FINGERPRINT_KINDS as readonly string[]).includes(fingerprintKind)) {
    throw new Error(`[wiki-v1] invalid fingerprint_kind "${fingerprintKind}"`);
  }
  if (fingerprint != null && fingerprintKind === 'none') {
    throw new Error('[wiki-v1] a staleness_fingerprint requires fingerprint_kind commit | content-hash.');
  }
  if (fingerprint == null && fingerprintKind !== 'none') {
    throw new Error(`[wiki-v1] fingerprint_kind "${fingerprintKind}" requires a staleness_fingerprint.`);
  }

  const properties: Record<string, RickydataGraphPrimitiveValue> = {
    page_slug: s(pageSlug),
    text: s(text),
    confidence_tier: s(claim.confidenceTier),
    confidence_score: { Float: claim.confidenceScore },
    status: s(status),
    staleness_fingerprint: fingerprint == null ? nul() : s(fingerprint),
    fingerprint_kind: s(fingerprintKind),
    source_ref: s(claim.sourceRef.trim()),
    created_at: s(claim.createdAt ?? now),
    updated_at: s(claim.updatedAt ?? now),
    rickydata_wiki_schema_version: s(WIKI_V1_SCHEMA_STAMP),
  };
  // v1.1 fields ride ONLY when provided — merge-mode leaves absent props untouched.
  if (claim.quoteExcerpt !== undefined) {
    if (claim.quoteExcerpt.length > WIKI_QUOTE_EXCERPT_MAX_CHARS) {
      throw new Error(
        `[wiki-v1] quote_excerpt is ${claim.quoteExcerpt.length} chars — the verbatim excerpt is hard-capped at ${WIKI_QUOTE_EXCERPT_MAX_CHARS} (§3.2 support-lite).`,
      );
    }
    properties['quote_excerpt'] = s(claim.quoteExcerpt);
  }
  if (claim.sourceDigest !== undefined) {
    assertSourceDigestShape(claim.sourceDigest);
    properties['source_digest'] = s(claim.sourceDigest);
  }
  if (claim.sensitivity !== undefined) {
    assertWikiSensitivity(claim.sensitivity);
    properties['sensitivity'] = s(claim.sensitivity);
  }

  return [
    {
      operation: 'create_node',
      id: deriveWikiClaimId(text),
      label: 'WikiClaim',
      properties,
      mode: 'merge',
    },
  ];
}

// ---------------------------------------------------------------------------
// WikiRevision (v1.1, SPEC-002 §3.5) — immutable page-body snapshots
// ---------------------------------------------------------------------------

export interface WikiRevisionInput {
  /** Owning page slug. */
  pageSlug: string;
  /** The FULL body at this revision (S2D-encrypted like page bodies). */
  bodyMd: string;
  /** sha256 hex of `bodyMd` — identity component; MUST match (throws otherwise). */
  bodySha256: string;
  /** The summary at this revision (secret-free; NOT embedded — the live page is the retrieval surface). */
  summary: string;
  /** `wiki-compiler/<ver>` | `manual-seed/<n>` | `migration/<script>`. */
  createdBy: string;
  /** ISO-8601 apply time; defaults to now. */
  createdAt?: string;
  /** The RickydataWikiCompilerRun id when compiler-applied. */
  compilerRunId?: string | null;
  /** `wiki-update:<pageSlug>:<runId>` — joins the HITL item + HomeDecision that approved it. */
  diffRef?: string | null;
}

/**
 * One merge-mode create_node for the immutable revision snapshot. Identical
 * re-apply of the same body derives the same id and merges (idempotent no-op)
 * — the immutability law (§3.5 extends L1) holds because the id IS the
 * content hash: a different body is a DIFFERENT node, never a mutation.
 * Revisions are provenance, not retrieval targets — callers always pass
 * `skip_embedding: true` on the write request.
 */
export function buildWikiRevisionWriteOps(
  input: WikiRevisionInput,
  opts: { now?: string } = {},
): RickydataGraphWriteOperation[] {
  assertWikiV1NodeLabel('WikiRevision');
  const now = opts.now ?? new Date().toISOString();
  const pageSlug = input.pageSlug.trim();
  if (!pageSlug) throw new Error('[wiki-v1] revision page_slug must not be empty');
  if (!input.bodyMd.trim()) throw new Error('[wiki-v1] revision body_md must not be empty');
  if (!input.summary.trim()) throw new Error('[wiki-v1] revision summary must not be empty');
  assertSecretFreeSummary(input.summary);
  if (!input.createdBy.trim()) throw new Error('[wiki-v1] revision created_by must not be empty');
  const bodySha256 = input.bodySha256.trim().toLowerCase();
  const actual = sha256Hex(input.bodyMd);
  if (bodySha256 !== actual) {
    throw new Error(
      `[wiki-v1] revision body_sha256 mismatch: got "${input.bodySha256}", sha256(body_md) is "${actual}" — ` +
        'the revision id IS the content hash; refusing to mint a lying snapshot.',
    );
  }

  const properties: Record<string, RickydataGraphPrimitiveValue> = {
    page_slug: s(pageSlug),
    body_md: s(input.bodyMd),
    body_sha256: s(bodySha256),
    summary: s(input.summary),
    created_at: s(input.createdAt ?? now),
    created_by: s(input.createdBy.trim()),
    compiler_run_id: input.compilerRunId == null ? nul() : s(input.compilerRunId),
    diff_ref: input.diffRef == null ? nul() : s(input.diffRef),
    rickydata_wiki_schema_version: s(WIKI_V1_SCHEMA_STAMP),
  };

  return [
    {
      operation: 'create_node',
      id: deriveWikiRevisionId(pageSlug, bodySha256),
      label: 'WikiRevision',
      properties,
      mode: 'merge',
    },
  ];
}

/** One wiki edge, canonical concatenated id, stamped with created_at + schema version. */
export function buildWikiEdgeOp(
  fromId: string,
  type: WikiV1EdgeType,
  toId: string,
  opts: { now?: string; properties?: Record<string, RickydataGraphPrimitiveValue> } = {},
): RickydataGraphWriteOperation {
  assertWikiV1EdgeType(type);
  const from = fromId.trim();
  const to = toId.trim();
  if (!from || !to) throw new Error('[wiki-v1] edge endpoints must not be empty');
  const now = opts.now ?? new Date().toISOString();
  return {
    operation: 'create_edge',
    id: deriveWikiEdgeId(from, type, to),
    from,
    to,
    edge_type: type,
    properties: {
      ...(opts.properties ?? {}),
      created_at: s(now),
      rickydata_wiki_schema_version: s(WIKI_V1_SCHEMA_STAMP),
    },
  };
}

// ---------------------------------------------------------------------------
// The AKC label registry (SPEC-001 §3) — one guard file owns ALL program labels.
// ---------------------------------------------------------------------------

/**
 * Every PRIVATE label the Agentic Knowledge Compiler program may write, across
 * all phases. Wiki labels (Phase 3) + the ContextPack log node (Phase 4) + the
 * reflect snapshot (Phase 5/6) + the canvas gate report (Phase 7). Adding a
 * label is an SDK change by design — the registry IS the schema governance
 * (there is no engine-side schema to update).
 */
export const AKC_PRIVATE_LABELS = [
  ...WIKI_V1_NODE_LABELS,
  'RickydataContextPack',
  'RickydataReflectSnapshot',
  'RickydataCanvasGateReport',
] as const;

export type AkcPrivateLabel = (typeof AKC_PRIVATE_LABELS)[number];

export function assertAkcPrivateLabel(label: string): asserts label is AkcPrivateLabel {
  if (!(AKC_PRIVATE_LABELS as readonly string[]).includes(label)) {
    throw new Error(
      `[akc] label "${label}" is not in the AKC private-label registry (${AKC_PRIVATE_LABELS.join(', ')})`,
    );
  }
}

// ---------------------------------------------------------------------------
// ContextPack log node (SPEC-003 §5, D4: log-only)
// ---------------------------------------------------------------------------

/** id = uuidv5('context-pack:<anchorKind>:<anchorKey>:<compiledAt>') in the HOME namespace. */
export function deriveContextPackId(anchorKind: string, anchorKey: string, compiledAt: string): string {
  return uuidv5(`context-pack:${anchorKind}:${anchorKey}:${compiledAt}`);
}

/**
 * v1.1 manifest entry (SPEC-003 §5): one per pack item across all sections.
 * `id` is the item's durable identity (wiki slug, claim id, decision
 * source_ref_id, sheet id, trap name, question id); `contentHash` = sha256
 * (12-hex prefix) of the item text AS RENDERED into the pack.
 */
export interface ContextPackSelectedItem {
  section: string;
  id: string;
  contentHash: string;
  rankReason?: string;
  tokenEstimate: number;
}

/**
 * v1.1 omitted entry (SPEC-003 §5): keeps the per-section counts and adds,
 * for budget-pruned items that ranked ABOVE at least one included peer, their
 * id — silent high-rank omissions are the manifest's blind spot otherwise.
 */
export interface ContextPackOmittedEntry {
  section: string;
  count?: number;
  reason: string;
  /** High-rank omission identity (present only for above-an-included-peer drops). */
  id?: string;
}

export interface ContextPackLogInput {
  /** 'surface' | 'task' | 'repo' (SPEC-003 §2 anchor kinds; free string for forward-compat). */
  anchorKind: string;
  /** The anchor key (stage key, RoadmapItem slug, or repo id). */
  anchorKey: string;
  /** ISO-8601 compile timestamp (part of the node id — one log node per compile). */
  compiledAt: string;
  /** sha256 hex over the canonical input set (SPEC-003 §3.9). */
  reproducibilityHash: string;
  /** ~4 chars/token estimate of the compiled pack. */
  tokenEstimate: number;
  /** Which consumer asked ('voice-guide' | 'plugin' | 'canvas' | 'code-delegate' | …). */
  consumer: string;
  /** Per-section item counts, JSON-stringified into `section_counts_json`. */
  sectionCounts: Record<string, number>;
  /**
   * v1.1 REQUIRED ordered manifest — every included pack item, JSON-stringified
   * into `selected_items_json` (spec wire keys: section, id, content_hash,
   * rank_reason?, token_estimate). Same reproducibility hash ⟺ same ordered
   * selected items. Callers must account for EVERY included item.
   */
  selectedItems: ContextPackSelectedItem[];
  /** The pack's `omitted` accounting (v1.1 shape), JSON-stringified into `omitted_json`. */
  omitted: ContextPackOmittedEntry[];
}

/**
 * The ContextPack LOG node write op (PRIVATE, merge, log-only — never a
 * retrieval target, so callers pass `skip_embedding: true` on the request).
 * Records that a pack was compiled, for what, and what the budget dropped —
 * the pack CONTENT itself is not persisted (D4).
 */
export function buildContextPackLogOp(input: ContextPackLogInput): RickydataGraphWriteOperation {
  assertAkcPrivateLabel('RickydataContextPack');
  const anchorKind = input.anchorKind.trim();
  const anchorKey = input.anchorKey.trim();
  const compiledAt = input.compiledAt.trim();
  if (!anchorKind || !anchorKey || !compiledAt) {
    throw new Error('[akc] context-pack log requires anchorKind, anchorKey and compiledAt');
  }
  if (!/^[0-9a-f]{64}$/.test(input.reproducibilityHash)) {
    throw new Error('[akc] reproducibilityHash must be a sha256 hex string');
  }
  if (!Array.isArray(input.selectedItems)) {
    throw new Error('[akc] selectedItems is required (v1.1 manifest — account for every included item)');
  }
  for (const item of input.selectedItems) {
    if (!item.section?.trim() || !item.id?.trim() || !item.contentHash?.trim()) {
      throw new Error('[akc] every selected item needs section, id and contentHash');
    }
  }
  // Wire shape per SPEC-003 §5: snake_case keys, rank_reason only when present.
  const selectedItemsWire = input.selectedItems.map((item) => ({
    section: item.section,
    id: item.id,
    content_hash: item.contentHash,
    ...(item.rankReason !== undefined ? { rank_reason: item.rankReason } : {}),
    token_estimate: item.tokenEstimate,
  }));
  return {
    operation: 'create_node',
    id: deriveContextPackId(anchorKind, anchorKey, compiledAt),
    label: 'RickydataContextPack',
    properties: {
      anchor_kind: s(anchorKind),
      anchor_key: s(anchorKey),
      compiled_at: s(compiledAt),
      reproducibility_hash: s(input.reproducibilityHash),
      token_estimate: { Integer: Math.max(0, Math.round(input.tokenEstimate)) },
      consumer: s(input.consumer.trim() || 'unknown'),
      section_counts_json: s(JSON.stringify(input.sectionCounts)),
      selected_items_json: s(JSON.stringify(selectedItemsWire)),
      omitted_json: s(JSON.stringify(input.omitted)),
      schema_version: s('context-pack/v1'),
      rickydata_wiki_schema_version: s(WIKI_V1_SCHEMA_STAMP),
    },
    mode: 'merge',
  };
}
