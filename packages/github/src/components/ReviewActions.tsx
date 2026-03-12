import { useState } from 'react';

interface ReviewActionsProps {
  executionId: string;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
  onRequestChanges: (executionId: string, comment: string) => void;
  isLoading?: boolean;
}

export function ReviewActions({ executionId, onApprove, onReject, onRequestChanges, isLoading }: ReviewActionsProps) {
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(executionId)}
          disabled={isLoading}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Approve & Merge
        </button>
        <button
          onClick={() => onReject(executionId)}
          disabled={isLoading}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Reject
        </button>
        <button
          onClick={() => setShowComment(!showComment)}
          className="rounded-lg border border-surface-300 dark:border-surface-600 px-4 py-2 text-sm font-medium hover:bg-surface-100 dark:hover:bg-surface-800"
        >
          Request Changes
        </button>
      </div>
      {showComment && (
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Describe changes needed..."
            className="flex-1 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-900 px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => { onRequestChanges(executionId, comment); setComment(''); setShowComment(false); }}
            disabled={!comment.trim() || isLoading}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
