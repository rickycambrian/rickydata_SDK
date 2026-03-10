import React, { useState, type CSSProperties } from 'react';

export interface SecretFormProps {
  secretKeys: string[];
  configuredKeys: string[];
  onSave: (secrets: Record<string, string>) => Promise<void>;
  onDelete?: (() => Promise<void>) | null;
  onClose?: () => void;
  className?: string;
}

// ─── Inline Styles ──────────────────────────────────────────

const container: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: 'monospace',
  color: '#9ca3af',
  marginBottom: '4px',
};

const configuredBadge: CSSProperties = {
  marginLeft: '6px',
  color: '#10b981',
  fontFamily: 'sans-serif',
};

const inputWrapper: CSSProperties = {
  position: 'relative',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 36px 8px 12px',
  fontSize: '14px',
  fontFamily: 'monospace',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.1)',
  backgroundColor: '#1f2937',
  color: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

const toggleBtn: CSSProperties = {
  position: 'absolute',
  right: '8px',
  top: '50%',
  transform: 'translateY(-50%)',
  padding: '4px',
  background: 'none',
  border: 'none',
  color: '#9ca3af',
  cursor: 'pointer',
  fontSize: '14px',
};

const feedbackBase: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px',
  borderRadius: '8px',
  fontSize: '12px',
};

const feedbackSuccess: CSSProperties = {
  ...feedbackBase,
  backgroundColor: 'rgba(16,185,129,0.1)',
  border: '1px solid rgba(16,185,129,0.2)',
  color: '#34d399',
};

const feedbackError: CSSProperties = {
  ...feedbackBase,
  backgroundColor: 'rgba(239,68,68,0.1)',
  border: '1px solid rgba(239,68,68,0.2)',
  color: '#f87171',
};

const btnRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const saveBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 500,
  borderRadius: '6px',
  border: 'none',
  backgroundColor: '#6366f1',
  color: '#fff',
  cursor: 'pointer',
  transition: 'opacity 0.15s',
};

const cancelBtn: CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 500,
  borderRadius: '6px',
  border: 'none',
  background: 'none',
  color: '#9ca3af',
  cursor: 'pointer',
};

const deleteBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 10px',
  fontSize: '12px',
  fontWeight: 500,
  borderRadius: '6px',
  border: 'none',
  background: 'none',
  color: '#f87171',
  cursor: 'pointer',
};

/**
 * Generic secret/password form with show/hide toggle.
 * Uses inline styles — no CSS framework dependency.
 */
export function SecretForm({ secretKeys, configuredKeys, onSave, onDelete, onClose, className }: SecretFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const key of secretKeys) init[key] = '';
    return init;
  });
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const hasAnyValue = Object.values(values).some(v => v.trim().length > 0);

  const handleSave = async () => {
    const secrets: Record<string, string> = {};
    for (const [key, val] of Object.entries(values)) {
      if (val.trim()) secrets[key] = val.trim();
    }
    if (Object.keys(secrets).length === 0) return;

    setSaving(true);
    setFeedback(null);
    try {
      await onSave(secrets);
      setFeedback({ type: 'success', message: 'Secrets saved successfully.' });
      setValues(prev => {
        const next = { ...prev };
        for (const k of Object.keys(next)) next[k] = '';
        return next;
      });
      if (onClose) setTimeout(onClose, 800);
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await onDelete();
      setFeedback({ type: 'success', message: 'Secrets removed.' });
      if (onClose) setTimeout(onClose, 800);
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to remove.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={container} className={className}>
      {secretKeys.map(key => {
        const isVisible = showValues[key] ?? false;
        const isConfigured = configuredKeys.includes(key);

        return (
          <div key={key}>
            <label style={labelStyle}>
              {key}
              {isConfigured && <span style={configuredBadge}>(configured)</span>}
            </label>
            <div style={inputWrapper}>
              <input
                type={isVisible ? 'text' : 'password'}
                value={values[key]}
                onChange={e => setValues(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={isConfigured ? 'Enter new value to update' : 'Enter value'}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowValues(prev => ({ ...prev, [key]: !isVisible }))}
                style={toggleBtn}
                aria-label={isVisible ? 'Hide' : 'Show'}
              >
                {isVisible ? '\u{1F441}\u{FE0F}\u{200D}\u{1F5E8}\u{FE0F}' : '\u{1F441}\u{FE0F}'}
              </button>
            </div>
          </div>
        );
      })}

      {feedback && (
        <div style={feedback.type === 'success' ? feedbackSuccess : feedbackError}>
          {feedback.type === 'success' ? '\u2713' : '\u26A0'} {feedback.message}
        </div>
      )}

      <div style={btnRow}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleSave}
            disabled={saving || !hasAnyValue}
            style={{ ...saveBtn, opacity: saving || !hasAnyValue ? 0.4 : 1 }}
          >
            {saving ? 'Saving...' : 'Save Keys'}
          </button>
          {onClose && (
            <button onClick={onClose} style={cancelBtn}>Cancel</button>
          )}
        </div>
        {onDelete && configuredKeys.length > 0 && (
          <button onClick={handleDelete} disabled={deleting} style={deleteBtn}>
            {deleting ? '...' : '\u{1F5D1} Remove'}
          </button>
        )}
      </div>
    </div>
  );
}
