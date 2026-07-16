import React, { type CSSProperties, type ReactNode } from 'react';
import type { KnowledgeWorkPipelineModel, KnowledgeWorkStep, KnowledgeWorkStepStatus } from 'rickydata/knowledge';

export interface KnowledgeWorkPipelineProps {
  pipeline: KnowledgeWorkPipelineModel;
  selectedStepId?: string;
  onStepSelect?: (step: KnowledgeWorkStep) => void;
  renderStep?: (step: KnowledgeWorkStep) => ReactNode;
  className?: string;
}

const STATUS_LABEL: Record<KnowledgeWorkStepStatus, string> = {
  ready: 'Ready', empty: 'Empty', omitted: 'Omitted', incomplete: 'Incomplete',
};

const rootStyle: CSSProperties = {
  color: 'var(--rd-kw-ink, var(--ink, #1d241f))',
  fontFamily: 'var(--rd-kw-font, var(--sans, system-ui, sans-serif))',
};

export function KnowledgeWorkPipeline({
  pipeline,
  selectedStepId,
  onStepSelect,
  renderStep,
  className,
}: KnowledgeWorkPipelineProps) {
  return (
    <section className={className} data-rd-knowledge-work="" style={rootStyle}>
      <header style={{ marginBottom: '1rem' }}>
        <p style={{ margin: 0, color: 'var(--rd-kw-muted, var(--muted, #657168))', lineHeight: 1.55 }}>{pipeline.brief}</p>
        <p style={{ margin: '0.55rem 0 0', fontSize: '0.75rem', color: 'var(--rd-kw-muted, var(--muted, #657168))' }}>
          {pipeline.anchor.kind}: {pipeline.anchor.key} · {pipeline.coverage} coverage · {pipeline.tokenEstimate} tokens
        </p>
      </header>
      <ol aria-label="Knowledge work pipeline" style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--rd-kw-line, var(--line, #d9ded9))', borderRadius: 'var(--rd-kw-radius, var(--radius, 12px))', overflow: 'hidden' }}>
        {pipeline.steps.map((step, index) => {
          const selected = selectedStepId === step.id;
          const content = (
            <>
              <span aria-hidden="true" style={{ color: 'var(--rd-kw-muted, var(--muted, #657168))', fontVariantNumeric: 'tabular-nums' }}>{String(index + 1).padStart(2, '0')}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ display: 'block', fontWeight: 600 }}>{step.label}</strong>
                <span style={{ display: 'block', marginTop: '0.2rem', color: 'var(--rd-kw-muted, var(--muted, #657168))', fontSize: '0.875rem', lineHeight: 1.4 }}>{step.description}</span>
                {renderStep ? renderStep(step) : null}
              </span>
              <span style={{ textAlign: 'right', fontSize: '0.75rem', color: step.status === 'incomplete' ? 'var(--rd-kw-danger, var(--danger, #a43b36))' : 'var(--rd-kw-muted, var(--muted, #657168))' }}>
                <span style={{ display: 'block' }}>{STATUS_LABEL[step.status]}</span>
                <span style={{ display: 'block', marginTop: '0.2rem' }}>{step.itemCount} items{step.omittedCount > 0 ? ` · ${step.omittedCount} omitted` : ''}</span>
              </span>
            </>
          );
          const style: CSSProperties = {
            display: 'flex', alignItems: 'flex-start', gap: '0.85rem', width: '100%', padding: '1rem',
            border: 0, borderTop: index === 0 ? 0 : '1px solid var(--rd-kw-line, var(--line, #d9ded9))',
            background: selected ? 'var(--rd-kw-selected, color-mix(in oklab, var(--accent, #486b55) 8%, transparent))' : 'var(--rd-kw-surface, var(--surface, #fff))',
            color: 'inherit', textAlign: 'left', font: 'inherit',
          };
          return <li key={step.id}>{onStepSelect ? <button type="button" aria-pressed={selected} onClick={() => onStepSelect(step)} style={{ ...style, cursor: 'pointer' }}>{content}</button> : <div style={style}>{content}</div>}</li>;
        })}
      </ol>
    </section>
  );
}
