import { useEffect, useRef } from 'react';
import type { ChatMessage, ToolExecution } from '../types/chat.js';
import { useAgentActions } from '../stores/actions.js';
import { ActionConfirmationCard } from './ActionConfirmationCard.js';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  streaming: boolean;
  onRevalidate?: (keys: string[]) => void;
}

/** Strip MCP server prefixes → "search papers" */
function humanizeToolName(name: string): string {
  const short = name.split('__').pop() || name;
  return short.replace(/_/g, ' ');
}

/** Extract a one-line summary of tool args. */
function toolArgsSummary(tool: ToolExecution): string | null {
  if (!tool.args || typeof tool.args !== 'object') return null;
  const args = tool.args as Record<string, unknown>;
  const query = args.query || args.search || args.question || args.topic;
  if (typeof query === 'string' && query.length > 0) {
    return query.length > 80 ? query.slice(0, 80) + '...' : query;
  }
  const id = args.arxiv_id || args.paper_id || args.id || args.entity_id;
  if (typeof id === 'string') return id;
  return null;
}

/** Truncate tool result to a brief preview. */
function toolResultPreview(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return `${parsed.length} result${parsed.length !== 1 ? 's' : ''} returned`;
    if (parsed.papers && Array.isArray(parsed.papers)) return `${parsed.papers.length} paper${parsed.papers.length !== 1 ? 's' : ''} found`;
    if (parsed.title) return String(parsed.title).slice(0, 100);
  } catch { /* not JSON */ }
  return content.length > 120 ? content.slice(0, 120) + '...' : content;
}

function ToolCard({ tool }: { tool: ToolExecution }) {
  const isRunning = !tool.result;
  const isError = tool.result?.isError;
  const humanName = humanizeToolName(tool.displayName || tool.name);
  const argsSummary = toolArgsSummary(tool);

  return (
    <div style={{
      borderRadius: '6px',
      border: `1px solid ${isError ? 'rgba(239,68,68,0.3)' : isRunning ? 'var(--chat-accent-muted, rgba(59,130,246,0.3))' : 'var(--chat-border)'}`,
      backgroundColor: isError ? 'rgba(127,29,29,0.2)' : isRunning ? 'var(--chat-accent-muted, rgba(59,130,246,0.05))' : 'var(--chat-bg-secondary)',
      padding: '6px 10px',
      fontSize: '11px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isRunning ? (
          <span style={{
            position: 'relative',
            width: '8px',
            height: '8px',
            display: 'inline-flex',
          }}>
            <span style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              backgroundColor: 'var(--chat-accent)',
              opacity: 0.5,
              animation: 'rickydata-chat-pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{
              position: 'relative',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: 'var(--chat-accent)',
            }} />
          </span>
        ) : isError ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--chat-error, #ef4444)" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth={2}>
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        <span style={{ fontWeight: 500, color: 'var(--chat-text)', textTransform: 'capitalize' }}>
          {humanName}
        </span>
        {isRunning && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--chat-accent)', opacity: 0.7 }}>
            running
          </span>
        )}
      </div>
      {argsSummary && isRunning && (
        <p style={{
          margin: '4px 0 0 18px',
          fontSize: '10px',
          color: 'var(--chat-text-muted)',
          fontStyle: 'italic',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {argsSummary}
        </p>
      )}
      {tool.result && !isError && tool.result.content && (
        <p style={{
          margin: '4px 0 0 18px',
          fontSize: '10px',
          color: 'var(--chat-text-muted)',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {toolResultPreview(tool.result.content)}
        </p>
      )}
      {isError && tool.result?.content && (
        <p style={{
          margin: '4px 0 0 18px',
          fontSize: '10px',
          color: 'var(--chat-error, #ef4444)',
          opacity: 0.8,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {tool.result.content.slice(0, 120)}
        </p>
      )}
    </div>
  );
}

export function ChatMessageList({ messages, streaming, onRevalidate }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const pendingActions = useAgentActions((s) => s.pendingActions);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingActions.size]);

  // Filter out empty assistant messages from history
  const visibleMessages = messages.filter((msg) => {
    if (msg.role === 'assistant' && !msg.content && !(msg.toolExecutions?.length)) return false;
    return true;
  });

  if (visibleMessages.length === 0) {
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
      {visibleMessages.map((msg, msgIdx) => {
        const isLastMessage = msgIdx === visibleMessages.length - 1;
        const tools = msg.toolExecutions || [];
        const hasRunningTools = tools.some((t) => !t.result);
        const hasContent = !!msg.content;

        return (
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
              {/* Rich tool execution cards */}
              {msg.role === 'assistant' && tools.length > 0 && (
                <div style={{ marginBottom: '6px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {tools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}

              {/* Message content or streaming indicator */}
              {hasContent ? (
                msg.content
              ) : streaming && msg.role === 'assistant' && isLastMessage ? (
                <span style={{ color: 'var(--chat-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {hasRunningTools ? 'Working...' : (
                    <span style={{ display: 'inline-flex', gap: '2px' }}>
                      <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--chat-text-muted)', animation: 'rickydata-chat-bounce 1s ease-in-out infinite' }} />
                      <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--chat-text-muted)', animation: 'rickydata-chat-bounce 1s ease-in-out 0.15s infinite' }} />
                      <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--chat-text-muted)', animation: 'rickydata-chat-bounce 1s ease-in-out 0.3s infinite' }} />
                    </span>
                  )}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {pendingActions.size > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Array.from(pendingActions.values()).map((proposal) => (
            <ActionConfirmationCard key={proposal.proposalId} proposal={proposal} onRevalidate={onRevalidate} />
          ))}
        </div>
      )}

      <div ref={endRef} />

      <style>{`
        @keyframes rickydata-chat-bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
