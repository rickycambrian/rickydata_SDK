import { describe, expect, it } from 'vitest';
import {
  MEMORY_V1_CONTRACT_VERSION,
  MEMORY_V1_NODE_LABELS,
  MEMORY_V1_EDGE_TYPES,
  OPEN_QUESTION_LABEL,
  assertMemoryV1NodeLabel,
  assertMemoryV1EdgeType,
  isMemoryV1NodeLabel,
  buildOpenQuestionWriteRequest,
  deriveOpenQuestionId,
} from '../src/kfdb/index.js';

const NOW = '2026-07-02T00:00:00.000Z';

describe('memory-v1 registry guard', () => {
  it('registers exactly the memory-v1 vocabulary', () => {
    expect(MEMORY_V1_CONTRACT_VERSION).toBe('rickydata.memory.v1');
    expect(OPEN_QUESTION_LABEL).toBe('OpenQuestion');
    expect(MEMORY_V1_NODE_LABELS).toContain('OpenQuestion');
    // Reused-not-reinvented: decisions/projects keep their existing labels.
    expect(MEMORY_V1_NODE_LABELS).toContain('HomeDecision');
    expect(MEMORY_V1_NODE_LABELS).toContain('Project');
    // No new edge type — supersession reuses SUPERSEDES.
    expect(MEMORY_V1_EDGE_TYPES).toContain('SUPERSEDES');
    expect(MEMORY_V1_EDGE_TYPES).toContain('RECEIVED_FEEDBACK');
  });

  it('refuses unregistered labels and edges (anti-fragmentation)', () => {
    expect(isMemoryV1NodeLabel('OpenQuestion')).toBe(true);
    expect(isMemoryV1NodeLabel('Preference')).toBe(false);
    expect(() => assertMemoryV1NodeLabel('Preference')).toThrow(/unregistered node label/);
    expect(() => assertMemoryV1NodeLabel('OpenQuestions')).toThrow(/OpenQuestions/);
    expect(() => assertMemoryV1EdgeType('ANSWERS')).toThrow(/unregistered edge type/);
  });
});

describe('buildOpenQuestionWriteRequest', () => {
  it('derives a deterministic idempotent id from (source_ref, question)', () => {
    const a = deriveOpenQuestionId('project:acme', 'What is the buyer budget?');
    const b = deriveOpenQuestionId('project:acme', 'What is the buyer budget?');
    const c = deriveOpenQuestionId('project:acme', 'Who signs off?');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('stamps the memory-v1 provenance/temporal fields on the node', () => {
    const req = buildOpenQuestionWriteRequest(
      {
        sourceRef: 'project:acme',
        question: 'What is the buyer budget?',
        category: 'clarification',
        topic: 'pricing',
        whyItMatters: 'sets the pitch numbers',
        priority: 7,
        createdBy: 'pipeline',
        confidence: 0.3,
      },
      { now: NOW },
    );

    expect(req.skip_embedding).toBe(true);
    expect(req.operations).toHaveLength(1);
    const op = req.operations[0];
    expect(op).toMatchObject({ operation: 'create_node', label: 'OpenQuestion', mode: 'merge' });
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.id).toBe(deriveOpenQuestionId('project:acme', 'What is the buyer budget?'));
    expect(op.properties).toMatchObject({
      question: { String: 'What is the buyer budget?' },
      category: { String: 'clarification' },
      topic: { String: 'pricing' },
      status: { String: 'open' },
      scope: { String: 'private' },
      source_ref: { String: 'project:acme' },
      created_by: { String: 'pipeline' },
      priority: { Integer: 7 },
      valid_from: { String: NOW },
      valid_to: { Null: null },
      superseded_by: { Null: null },
      rickydata_memory_schema_version: { String: 'rickydata.memory.v1' },
      rickydata_memory_kind: { String: 'OpenQuestion' },
    });
  });

  it('marks a question answered when an answer is present', () => {
    const req = buildOpenQuestionWriteRequest(
      { sourceRef: 's', question: 'q', category: 'clarification', createdBy: 'human', answer: '$50k' },
      { now: NOW },
    );
    const op = req.operations[0];
    if (op.operation !== 'create_node') throw new Error('expected create_node');
    expect(op.properties.status).toEqual({ String: 'answered' });
    expect(op.properties.answer).toEqual({ String: '$50k' });
  });

  it('supersession closes the old node and emits a SUPERSEDES edge (new → old)', () => {
    const oldId = deriveOpenQuestionId('s', 'old question');
    const req = buildOpenQuestionWriteRequest(
      { sourceRef: 's', question: 'new question', category: 'clarification', createdBy: 'agent', supersedesId: oldId },
      { now: NOW },
    );
    const newId = deriveOpenQuestionId('s', 'new question');
    expect(req.operations).toHaveLength(3);

    const closeOp = req.operations.find(
      (o) => o.operation === 'create_node' && o.id === oldId,
    );
    expect(closeOp).toBeDefined();
    if (closeOp && closeOp.operation === 'create_node') {
      expect(closeOp.properties).toMatchObject({
        valid_to: { String: NOW },
        superseded_by: { String: newId },
        status: { String: 'superseded' },
      });
    }

    const edge = req.operations.find((o) => o.operation === 'create_edge');
    expect(edge).toBeDefined();
    if (edge && edge.operation === 'create_edge') {
      expect(edge).toMatchObject({ from: newId, to: oldId, edge_type: 'SUPERSEDES' });
    }
  });

  it('refuses to let a caller override a reserved provenance key', () => {
    expect(() =>
      buildOpenQuestionWriteRequest({
        sourceRef: 's',
        question: 'q',
        category: 'clarification',
        createdBy: 'human',
        properties: { source_ref: { String: 'spoofed' } },
      }),
    ).toThrow(/reserved/);
  });
});
