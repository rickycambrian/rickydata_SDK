import { useChatBubble } from '../stores/bubble.js';
import type { Thread } from '../types/thread.js';

export interface ThreadDrawerProps {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => Promise<void>;
  onNewThread: () => Promise<void>;
}

export function ThreadDrawer({ threads, activeThreadId, onSelectThread, onNewThread }: ThreadDrawerProps) {
  const formatScope = (thread: Thread) => {
    if (!thread.context_type || thread.context_type === 'general') return 'General';
    return thread.context_type.replace(/_/g, ' ');
  };

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <button
        type="button"
        onClick={() => onNewThread().catch(() => undefined)}
        style={{
          width: '100%',
          borderRadius: 'var(--chat-radius)',
          border: '1px dashed var(--chat-border)',
          backgroundColor: 'transparent',
          padding: '8px 12px',
          fontSize: 'var(--chat-font-size)',
          fontFamily: 'var(--chat-font-family)',
          color: 'var(--chat-text-muted)',
          cursor: 'pointer',
        }}
      >
        + New Thread
      </button>

      {threads.length === 0 ? (
        <p style={{
          fontSize: 'var(--chat-font-size)',
          fontFamily: 'var(--chat-font-family)',
          color: 'var(--chat-text-muted)',
          padding: '8px',
          textAlign: 'center',
          margin: 0,
        }}>
          No threads yet.
        </p>
      ) : (
        threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            onClick={() => {
              onSelectThread(thread.id).catch(() => undefined);
              useChatBubble.getState().setMode('chat');
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              borderRadius: 'var(--chat-radius)',
              border: thread.id === activeThreadId
                ? '1px solid var(--chat-border-accent)'
                : '1px solid var(--chat-border)',
              backgroundColor: thread.id === activeThreadId
                ? 'var(--chat-accent-muted)'
                : 'transparent',
              padding: '8px 12px',
              fontSize: 'var(--chat-font-size)',
              fontFamily: 'var(--chat-font-family)',
              color: thread.id === activeThreadId
                ? 'var(--chat-text)'
                : 'var(--chat-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <p style={{
              margin: 0,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {thread.title}
            </p>
            <div style={{
              marginTop: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              fontSize: '10px',
              color: 'var(--chat-text-muted)',
            }}>
              <span>{new Date(thread.updated_at).toLocaleDateString()}</span>
              <span style={{
                borderRadius: '3px',
                border: '1px solid var(--chat-border)',
                padding: '1px 6px',
                fontSize: '9px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {formatScope(thread)}
              </span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
