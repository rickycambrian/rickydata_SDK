import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types/chat.js';
import { useAgentActions } from '../stores/actions.js';
import { ActionConfirmationCard } from './ActionConfirmationCard.js';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  onRevalidate?: (keys: string[]) => void;
}

export function ChatMessageList({ messages, streaming, onRevalidate }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const pendingActions = useAgentActions((s) => s.pendingActions);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingActions.size]);

  if (messages.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}>
        <p style={{
          fontSize: 'var(--chat-font-size)',
          fontFamily: 'var(--chat-font-family)',
          color: 'var(--chat-text-muted)',
          margin: 0,
        }}>
          Ask a question to get started.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      {messages.map((msg) => (
        <div
          key={msg.id}
          style={{
            display: 'flex',
            justifyContent:
              msg.role === 'user' ? 'flex-end' : msg.role === 'system' ? 'center' : 'flex-start',
          }}
        >
          <div
            style={{
              maxWidth: '90%',
              borderRadius: 'var(--chat-radius-lg)',
              padding: '8px 12px',
              fontSize: 'var(--chat-font-size)',
              fontFamily: 'var(--chat-font-family)',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              ...(msg.role === 'user'
                ? {
                    backgroundColor: 'var(--chat-bg-tertiary)',
                    color: 'var(--chat-text)',
                  }
                : msg.role === 'system'
                  ? {
                      backgroundColor: 'var(--chat-bg)',
                      color: 'var(--chat-text-secondary)',
                      border: '1px solid var(--chat-border)',
                    }
                  : {
                      backgroundColor: 'var(--chat-accent-muted)',
                      color: 'var(--chat-text)',
                      border: '1px solid var(--chat-border)',
                    }),
            }}
          >
            {/* Tool execution badges */}
            {msg.role === 'assistant' && (msg.toolExecutions?.length ?? 0) > 0 && (
              <div style={{ marginBottom: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {msg.toolExecutions!.map((tool) => (
                  <div
                    key={tool.id}
                    style={{
                      borderRadius: 'var(--chat-radius)',
                      border: `1px solid ${tool.result?.isError ? 'var(--chat-error-muted)' : 'var(--chat-border)'}`,
                      backgroundColor: tool.result?.isError ? 'var(--chat-error-muted)' : 'var(--chat-bg-secondary)',
                      padding: '2px 8px',
                      fontSize: '10px',
                      color: tool.result?.isError ? 'var(--chat-error)' : 'var(--chat-text-secondary)',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{tool.displayName}</span>
                    <span style={{ marginLeft: '4px', color: 'var(--chat-text-muted)' }}>
                      {tool.result ? (tool.result.isError ? 'failed' : 'done') : 'running'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {msg.content || (streaming && msg.role === 'assistant'
              ? ((msg.toolExecutions || []).some((t) => !t.result) ? 'Using tools...' : 'Thinking...')
              : '')}
          </div>
        </div>
      ))}

      {pendingActions.size > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.from(pendingActions.values()).map((proposal) => (
            <ActionConfirmationCard key={proposal.proposalId} proposal={proposal} onRevalidate={onRevalidate} />
          ))}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
