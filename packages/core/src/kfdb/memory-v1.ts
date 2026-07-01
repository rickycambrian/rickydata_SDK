/**
 * kfdb/memory-v1.ts — the `rickydata.memory.v1` writer library + label-registry guard.
 *
 * This module is the single write path and anti-fragmentation guard for the
 * canonical memory contract. See `knowledgeflow_db/specs/MEMORY_V1_SPEC.md` for
 * the full contract; the short version:
 *
 *   - memory-v1 introduces exactly ONE new node label: `OpenQuestion`. Every other
 *     memory concept reuses an existing home (answer sheets = the KFDB API module,
 *     decisions = `HomeDecision`, projects = `Project`, skills = files). Introducing
 *     a second structure for an existing concept is a contract violation.
 *   - all memory-v1 nodes carry uniform provenance/temporal fields (Part 4 of the
 *     spec): `source_ref`, `created_by`, `confidence`, `valid_from`,
 *     `valid_to` (null = active), `superseded_by`.
 *   - supersession reuses the existing `SUPERSEDES` edge — NO new edge type.
 *
 * rickydata_home imports this through its `KfdbWriter.write` seam; the capture /
 * injection plugin imports it and POSTs the built body to `/api/v1/write`. Both
 * get the same guard, so a typo (`OpenQuestions`) or a well-meant new concept
 * (`Preference`) fails loudly at write time instead of silently fragmenting.
 */
import {
  GraphEdgeType,
  GraphEntityKind,
  deriveRickydataGraphId,
  deriveRickydataGraphEdgeId,
  rickydataGraphValue,
  type RickydataGraphPrimitiveValue,
  type RickydataGraphWriteOperation,
  type RickydataGraphWriteRequest,
} from './rickydata-graph.js';

/** The memory contract version stamped on every memory-v1 node. */
export const MEMORY_V1_CONTRACT_VERSION = 'rickydata.memory.v1';

/** The ONE new node label the memory contract introduces. */
export const OPEN_QUESTION_LABEL = GraphEntityKind.OpenQuestion;

/**
 * Registered memory-v1 node labels (the anti-fragmentation allowlist). A memory
 * concept maps to exactly ONE of these — never a second label for the same
 * concept. `OpenQuestion` is new; the rest keep their own tested single-writer
 * paths (home `engine.ts` / `mission-control.ts`) and are registered here so a
 * memory-v1 write that touches them passes the guard.
 */
export const MEMORY_V1_NODE_LABELS = [
  'OpenQuestion', // NEW — open/clarification questions
  'HomeDecision', // existing — human decisions (rickydata_home/src/hitl/engine.ts)
  'DecisionSubject', // existing — decision cohesion shadow node
  'Project', // existing — projects (mission control)
] as const;

/**
 * Registered memory-v1 edge types. ALL pre-existing — the memory contract adds
 * NO new edge type. Supersession reuses `SUPERSEDES`; an answered question links
 * to its decision with `RECEIVED_FEEDBACK` (a human decision IS feedback on the
 * node, per `engine.ts`).
 */
export const MEMORY_V1_EDGE_TYPES = [
  'SUPERSEDES', // temporal supersession (new → old)
  'RECEIVED_FEEDBACK', // HomeDecision → OpenQuestion (answered)
  'DECIDED_ABOUT', // HomeDecision → DecisionSubject (cohesion)
  'HAS_WORK_INTENT', // decision → source (promote)
  'INTENT_CHAIN', // decision → source (park)
] as const;

export type MemoryV1NodeLabel = (typeof MEMORY_V1_NODE_LABELS)[number];
export type MemoryV1EdgeType = (typeof MEMORY_V1_EDGE_TYPES)[number];

/** Reserved property keys the writer stamps; callers cannot override them. */
export const MEMORY_V1_RESERVED_KEYS = [
  'question',
  'category',
  'topic',
  'why_it_matters',
  'priority',
  'answer',
  'status',
  'scope',
  'source_ref',
  'created_by',
  'confidence',
  'valid_from',
  'valid_to',
  'superseded_by',
  'rickydata_memory_schema_version',
  'rickydata_memory_kind',
] as const;

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

export function isMemoryV1NodeLabel(label: string): label is MemoryV1NodeLabel {
  return (MEMORY_V1_NODE_LABELS as readonly string[]).includes(label);
}

export function isMemoryV1EdgeType(edgeType: string): edgeType is MemoryV1EdgeType {
  return (MEMORY_V1_EDGE_TYPES as readonly string[]).includes(edgeType);
}

/** Throw unless `label` is a registered memory-v1 node label. */
export function assertMemoryV1NodeLabel(label: string): asserts label is MemoryV1NodeLabel {
  if (!isMemoryV1NodeLabel(label)) {
    throw new Error(
      `[memory-v1] refusing to write unregistered node label "${label}". ` +
        `Registered labels: ${MEMORY_V1_NODE_LABELS.join(', ')}. ` +
        `Add it to MEMORY_V1_SPEC.md + the registry (rickydata_graph.rs + memory-v1.ts) ` +
        `before writing — never a second structure for an existing concept.`,
    );
  }
}

/** Throw unless `edgeType` is a registered memory-v1 edge type. */
export function assertMemoryV1EdgeType(edgeType: string): asserts edgeType is MemoryV1EdgeType {
  if (!isMemoryV1EdgeType(edgeType)) {
    throw new Error(
      `[memory-v1] refusing to write unregistered edge type "${edgeType}". ` +
        `Registered edge types: ${MEMORY_V1_EDGE_TYPES.join(', ')}. ` +
        `memory-v1 introduces NO new edge type — reuse SUPERSEDES / RECEIVED_FEEDBACK.`,
    );
  }
}

// ---------------------------------------------------------------------------
// OpenQuestion writer
// ---------------------------------------------------------------------------

export type OpenQuestionStatus = 'open' | 'answered' | 'dismissed' | 'superseded';

export interface OpenQuestionInput {
  /** Provenance origin key (project/session/repo/skill/escalation id). Part of the node identity. */
  sourceRef: string;
  /** The Mom-Test-clean question to ask. Part of the node identity. */
  question: string;
  /** e.g. a clarify `StrongCategory`, or `user_preference` / `project_decision` / `clarification`. */
  category: string;
  /** The subject / persona-field the answer resolves (was `personaField` in the clarify contract). */
  topic?: string;
  /** One line: why answering this changes the outcome. */
  whyItMatters?: string;
  /** Deterministic priority; higher = ask sooner (ranking brain = ported `gapPriority`). */
  priority?: number;
  /** Resolved answer; '' = unresolved. */
  answer?: string;
  /** Lifecycle. Defaults to 'answered' when `answer` is non-empty, else 'open'. */
  status?: OpenQuestionStatus;
  /** The keyspace this is written to; self-describes the node. */
  scope?: 'private' | 'global';
  /** Who created it: 'pipeline' | 'human' | 'agent' | wallet address. */
  createdBy: string;
  /** [0,1] confidence in the question's relevance (mining seeds low; explicit user high). */
  confidence?: number;
  /** ISO timestamp the fact became true. Defaults to now. */
  validFrom?: string;
  /** ISO timestamp | null. null = active. */
  validTo?: string | null;
  /**
   * If this question supersedes a prior one, its node id. Emits a `SUPERSEDES`
   * edge (new → old) and closes the old node (`valid_to`, `superseded_by`,
   * `status: superseded`).
   */
  supersedesId?: string;
  /** Extra domain properties. Cannot override the reserved keys (see MEMORY_V1_RESERVED_KEYS). */
  properties?: Record<string, RickydataGraphPrimitiveValue>;
}

function stripReserved(
  props: Record<string, RickydataGraphPrimitiveValue> | undefined,
): Record<string, RickydataGraphPrimitiveValue> {
  if (!props) return {};
  const reserved = new Set<string>(MEMORY_V1_RESERVED_KEYS);
  const out: Record<string, RickydataGraphPrimitiveValue> = {};
  for (const [k, v] of Object.entries(props)) {
    if (reserved.has(k)) {
      throw new Error(`[memory-v1] property "${k}" is reserved and cannot be overridden by a caller.`);
    }
    out[k] = v;
  }
  return out;
}

/** Derive the deterministic node id for an OpenQuestion (idempotent merge key). */
export function deriveOpenQuestionId(sourceRef: string, question: string): string {
  return deriveRickydataGraphId(GraphEntityKind.OpenQuestion, [sourceRef, question]);
}

/**
 * Build an `/api/v1/write` body that upserts one or more `OpenQuestion` nodes,
 * stamping the memory-v1 provenance/temporal fields and handling supersession.
 * The returned body is the exact shape home's `KfdbWriter.write` and the plugin's
 * `apiRequest` already POST to `/api/v1/write`.
 */
export function buildOpenQuestionWriteRequest(
  input: OpenQuestionInput | OpenQuestionInput[],
  opts: { now?: string } = {},
): RickydataGraphWriteRequest {
  const now = opts.now ?? new Date().toISOString();
  const inputs = Array.isArray(input) ? input : [input];
  const operations: RickydataGraphWriteOperation[] = [];

  for (const q of inputs) {
    assertMemoryV1NodeLabel(OPEN_QUESTION_LABEL);
    const id = deriveOpenQuestionId(q.sourceRef, q.question);
    const answer = q.answer ?? '';
    const status: OpenQuestionStatus = q.status ?? (answer.trim().length > 0 ? 'answered' : 'open');
    const validTo = q.validTo === undefined ? null : q.validTo;

    const properties: Record<string, RickydataGraphPrimitiveValue> = {
      ...stripReserved(q.properties),
      question: rickydataGraphValue(q.question),
      category: rickydataGraphValue(q.category),
      topic: rickydataGraphValue(q.topic ?? ''),
      why_it_matters: rickydataGraphValue(q.whyItMatters ?? ''),
      priority: rickydataGraphValue(q.priority ?? 0),
      answer: rickydataGraphValue(answer),
      status: rickydataGraphValue(status),
      scope: rickydataGraphValue(q.scope ?? 'private'),
      source_ref: rickydataGraphValue(q.sourceRef),
      created_by: rickydataGraphValue(q.createdBy),
      confidence: rickydataGraphValue(q.confidence ?? 0),
      valid_from: rickydataGraphValue(q.validFrom ?? now),
      valid_to: validTo === null ? { Null: null } : rickydataGraphValue(validTo),
      superseded_by: { Null: null },
      rickydata_memory_schema_version: { String: MEMORY_V1_CONTRACT_VERSION },
      rickydata_memory_kind: { String: OPEN_QUESTION_LABEL },
    };

    operations.push({ operation: 'create_node', id, label: OPEN_QUESTION_LABEL, properties, mode: 'merge' });

    if (q.supersedesId) {
      // Close the superseded node (merge preserves its other props) …
      operations.push({
        operation: 'create_node',
        id: q.supersedesId,
        label: OPEN_QUESTION_LABEL,
        properties: {
          valid_to: rickydataGraphValue(now),
          superseded_by: rickydataGraphValue(id),
          status: rickydataGraphValue('superseded' satisfies OpenQuestionStatus),
        },
        mode: 'merge',
      });
      // … and point new → old with the existing SUPERSEDES edge.
      assertMemoryV1EdgeType(GraphEdgeType.Supersedes);
      operations.push({
        operation: 'create_edge',
        id: deriveRickydataGraphEdgeId(id, GraphEdgeType.Supersedes, q.supersedesId),
        from: id,
        to: q.supersedesId,
        edge_type: GraphEdgeType.Supersedes,
        properties: {
          created_at: rickydataGraphValue(now),
          rickydata_memory_schema_version: { String: MEMORY_V1_CONTRACT_VERSION },
        },
      });
    }
  }

  return { operations, skip_embedding: true };
}
