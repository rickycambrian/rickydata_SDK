import type {
  KnowledgeContextPack,
  KnowledgeWorkAnchor,
  KnowledgeWorkPipelineModel,
  KnowledgeWorkStep,
} from './types.js';

function anchorOf(pack: KnowledgeContextPack): KnowledgeWorkAnchor {
  const key = pack.anchor.surface ?? pack.anchor.taskSlug ?? pack.anchor.repoId ?? pack.anchor.lesson ?? '';
  return { kind: pack.anchor.kind, key };
}

function omissions(pack: KnowledgeContextPack, sections: string[]): number {
  return pack.omitted
    .filter((item) => sections.includes(item.section))
    .reduce((sum, item) => sum + item.count, 0)
    + pack.omitted_items.filter((item) => sections.includes(item.section)).length;
}

function step(
  pack: KnowledgeContextPack,
  input: Omit<KnowledgeWorkStep, 'status' | 'omittedCount'>,
): KnowledgeWorkStep {
  const omittedCount = omissions(pack, input.sections);
  const status = input.itemCount > 0
    ? 'ready'
    : omittedCount > 0
      ? 'omitted'
      : pack.coverage?.status === 'incomplete'
        ? 'incomplete'
        : 'empty';
  return { ...input, omittedCount, status };
}

/** Normalize a compiled pack into the same honest seven-step workflow in every host. */
export function createKnowledgeWorkPipeline(pack: KnowledgeContextPack): KnowledgeWorkPipelineModel {
  const estimate = pack.token_estimate;
  const steps: KnowledgeWorkStep[] = [
    step(pack, { id: 'orient', label: 'Orient', description: 'Start from the compiled brief and its exact anchor.', itemCount: pack.brief ? 1 : 0, sections: ['brief'] }),
    step(pack, { id: 'constraints', label: 'Constraints', description: 'Apply invariants, tool policy, and verified traps before acting.', itemCount: pack.invariants.length + pack.traps.length + (pack.allowed_tools?.length ?? 0), sections: ['invariants', 'traps', 'allowed_tools'] }),
    step(pack, { id: 'current-work', label: 'Current work', description: 'Resume in-flight work instead of rediscovering it.', itemCount: pack.work_in_progress.length, sections: ['work_in_progress'] }),
    step(pack, { id: 'evidence', label: 'Evidence', description: 'Inspect verification status and durable receipts.', itemCount: pack.verification.length, sections: ['verification'] }),
    step(pack, { id: 'knowledge', label: 'Knowledge', description: 'Use ranked wiki context and verified lessons.', itemCount: pack.wiki.length + pack.lessons.length, sections: ['wiki', 'lessons'] }),
    step(pack, { id: 'decisions', label: 'Prior decisions', description: 'Reuse prior human direction before making a new choice.', itemCount: pack.decisions.length, sections: ['decisions'] }),
    step(pack, { id: 'questions', label: 'Open questions', description: 'Keep unresolved assumptions explicit.', itemCount: pack.open_questions.length, sections: ['open_questions'] }),
  ];
  return {
    version: 'knowledge-work/v1',
    anchor: anchorOf(pack),
    brief: pack.brief,
    coverage: pack.coverage?.status ?? (pack.omitted.length > 0 ? 'bounded' : 'complete'),
    compiledAt: pack.compiled_at,
    reproducibilityHash: pack.reproducibility_hash,
    tokenEstimate: estimate,
    steps,
  };
}
