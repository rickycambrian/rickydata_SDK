import { useState } from 'react';
import { useAgentActions } from '../stores/actions.js';
import { useChatBubbleConfig } from '../providers/ChatBubbleProvider.js';
import type { ActionProposal } from '../types/actions.js';

export interface ActionConfirmationCardProps {
  proposal: ActionProposal;
  onRevalidate?: (keys: string[]) => void;
}

export function ActionConfirmationCard({ proposal, onRevalidate }: ActionConfirmationCardProps) {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<'confirmed' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { config } = useChatBubbleConfig();

  const handleConfirm = async () => {
    setProcessing(true);
    setError(null);
    try {
      const res = await config.callbacks?.onAction?.(proposal);
      setResult('confirmed');
      useAgentActions.getState().completeAction({ ...proposal, status: 'completed' });
      if (res?.revalidateKeys?.length && onRevalidate) {
        onRevalidate(res.revalidateKeys);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to confirm action');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    setProcessing(true);
    setError(null);
    try {
      setResult('rejected');
      useAgentActions.getState().removePendingAction(proposal.proposalId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject action');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div style={{
      borderRadius: 'var(--chat-radius-lg)',
      border: '1px solid var(--chat-border-accent)',
      backgroundColor: 'var(--chat-accent-muted)',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <div style={{
          display: 'flex',
          height: '24px',
          width: '24px',
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--chat-radius)',
          backgroundColor: 'var(--chat-warning-muted)',
        }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: '14px', height: '14px', color: 'var(--chat-warning)' }}
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            margin: 0,
            fontSize: '11px',
            fontWeight: 500,
            fontFamily: 'var(--chat-font-family)',
            color: 'var(--chat-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {proposal.actionType.replace(/_/g, ' ')}
          </p>
          <p style={{
            margin: '2px 0 0 0',
            fontSize: 'var(--chat-font-size)',
            fontFamily: 'var(--chat-font-family)',
            color: 'var(--chat-text)',
          }}>
            {proposal.description}
          </p>
        </div>
      </div>

      {error && (
        <p style={{
          margin: 0,
          fontSize: '11px',
          fontFamily: 'var(--chat-font-family)',
          color: 'var(--chat-error)',
        }}>
          {error}
        </p>
      )}

      {result ? (
        <div style={{
          fontSize: '11px',
          fontWeight: 500,
          fontFamily: 'var(--chat-font-family)',
          color: result === 'confirmed' ? 'var(--chat-success)' : 'var(--chat-text-muted)',
        }}>
          {result === 'confirmed' ? 'Action confirmed' : 'Action rejected'}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={processing}
            style={{
              flex: 1,
              borderRadius: 'var(--chat-radius)',
              backgroundColor: 'rgba(22, 163, 74, 0.8)',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 500,
              fontFamily: 'var(--chat-font-family)',
              color: '#fff',
              border: 'none',
              cursor: processing ? 'default' : 'pointer',
              opacity: processing ? 0.5 : 1,
            }}
          >
            {processing ? '...' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={processing}
            style={{
              flex: 1,
              borderRadius: 'var(--chat-radius)',
              backgroundColor: 'rgba(220, 38, 38, 0.8)',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 500,
              fontFamily: 'var(--chat-font-family)',
              color: '#fff',
              border: 'none',
              cursor: processing ? 'default' : 'pointer',
              opacity: processing ? 0.5 : 1,
            }}
          >
            {processing ? '...' : 'Reject'}
          </button>
        </div>
      )}
    </div>
  );
}
