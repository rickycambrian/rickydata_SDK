import React, { useState, useEffect, type CSSProperties } from 'react';
import { useSecrets } from '../hooks/secrets.js';
import { SecretForm } from './SecretForm.js';

export interface SecretOrchestratorProps {
  agentId: string;
  mcpServers?: string[];
  onAllConfigured?: () => void;
  className?: string;
  compact?: boolean;
}

// ─── Inline Styles ──────────────────────────────────────────

const wrapper: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const loadingBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px',
  borderRadius: '12px',
  border: '1px solid rgba(245,158,11,0.2)',
  backgroundColor: 'rgba(31,41,55,0.8)',
  fontSize: '12px',
  color: '#fcd34d',
};

const sectionBox: CSSProperties = {
  borderRadius: '12px',
  border: '1px solid rgba(245,158,11,0.2)',
  backgroundColor: 'rgba(31,41,55,0.8)',
  overflow: 'hidden',
};

const headerBtn: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'inherit',
};

const headerLabel: CSSProperties = {
  flex: 1,
  fontSize: '12px',
  fontWeight: 500,
  color: '#fcd34d',
};

const bodyBox: CSSProperties = {
  padding: '0 16px 16px',
};

/**
 * Discovers all missing secrets for an agent and renders collapsible
 * SecretForm sections for each. Calls `onAllConfigured` when done.
 */
export function SecretOrchestrator({
  agentId,
  mcpServers,
  onAllConfigured,
  className,
  compact,
}: SecretOrchestratorProps) {
  const { sections, loading, allConfigured, refresh } = useSecrets({ agentId, mcpServers });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-expand first section
  useEffect(() => {
    if (sections.length > 0 && expandedId === null) {
      setExpandedId(sections[0].id);
    }
  }, [sections, expandedId]);

  // Notify parent when all configured
  useEffect(() => {
    if (allConfigured) onAllConfigured?.();
  }, [allConfigured, onAllConfigured]);

  if (loading) {
    return (
      <div style={loadingBox} className={className}>
        <span style={{ animation: 'spin 1s linear infinite' }}>&#x21BB;</span>
        Checking configuration requirements...
      </div>
    );
  }

  if (sections.length === 0) return null;

  return (
    <div style={wrapper} className={className}>
      {sections.map(section => {
        const isExpanded = expandedId === section.id;

        return (
          <div key={section.id} style={sectionBox}>
            <button
              onClick={() => setExpandedId(isExpanded ? null : section.id)}
              style={headerBtn}
            >
              <span style={{ color: '#f59e0b' }}>{'\u26A0'}</span>
              <span style={headerLabel}>{section.label} required</span>
              <span style={{ color: '#6b7280', fontSize: '12px' }}>
                {isExpanded ? '\u25BC' : '\u25B6'}
              </span>
            </button>

            {isExpanded && (
              <div style={bodyBox}>
                <SecretForm
                  secretKeys={section.keys}
                  configuredKeys={section.configuredKeys}
                  onSave={async (secrets) => {
                    await section.save(secrets);
                    refresh();
                  }}
                  onClose={compact ? undefined : () => setExpandedId(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
