import { useCallback } from 'react';
import { useChatBubble } from '../stores/bubble.js';
import { useChatBubbleConfig } from '../providers/ChatBubbleProvider.js';
import { useWalletAuth } from '../hooks/useWalletAuth.js';
import { useChatBubbleEngine } from '../hooks/useChatBubbleEngine.js';
import { ChatWindowHeader } from './ChatWindowHeader.js';
import { ChatMessageList } from './ChatMessageList.js';
import { ChatInputBar } from './ChatInputBar.js';
import { ThreadDrawer } from './ThreadDrawer.js';
import type { ChatEngine } from '../types/chat.js';

/** Use external engine from config if provided, otherwise fall back to built-in engine. */
function useResolvedEngine(config: { engine?: ChatEngine }, builtInEngine: ReturnType<typeof useChatBubbleEngine>): ChatEngine {
  if (config.engine) return config.engine;
  return builtInEngine;
}

export function ChatBubbleWindow() {
  const { mode, isMinimized, restore } = useChatBubble();
  const { config } = useChatBubbleConfig();
  const wallet = config.wallet;
  const gatewayUrl = config.gatewayUrl ?? 'https://agents.rickydata.org';

  const { gatewayToken, status: gatewayStatus, error: gatewayError } = useWalletAuth(wallet, gatewayUrl);

  const chatContext = config.callbacks?.getPageContext?.() ?? null;

  const builtInEngine = useChatBubbleEngine({ context: chatContext, gatewayToken });
  const engine = useResolvedEngine(config, builtInEngine);

  const handleRevalidate = useCallback((keys: string[]) => {
    config.callbacks?.onRevalidate?.(keys);
  }, [config.callbacks]);

  const walletAddress = wallet.getAddress();

  if (isMinimized) {
    return (
      <button
        type="button"
        onClick={restore}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderRadius: '20px',
          backgroundColor: 'var(--chat-bg-secondary)',
          border: '1px solid var(--chat-border)',
          padding: '8px 16px',
          cursor: 'pointer',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{
          fontSize: 'var(--chat-font-size)',
          fontWeight: 500,
          fontFamily: 'var(--chat-font-family)',
          color: 'var(--chat-text)',
        }}>
          {config.title ?? 'Chat Assistant'}
        </span>
        {engine.streaming && (
          <span style={{
            height: '8px',
            width: '8px',
            borderRadius: '50%',
            backgroundColor: 'var(--chat-accent)',
            animation: 'rickydata-chat-pulse 1.5s ease-in-out infinite',
          }} />
        )}
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 40,
      display: 'flex',
      flexDirection: 'column',
      width: '408px',
      maxHeight: '600px',
      borderRadius: 'var(--chat-radius-lg)',
      border: '1px solid var(--chat-border)',
      backgroundColor: 'var(--chat-bg-secondary)',
      boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
      fontFamily: 'var(--chat-font-family)',
      overflow: 'hidden',
    }}>
      <ChatWindowHeader />

      {/* Gateway auth status indicators */}
      {walletAddress && gatewayStatus === 'authenticating' && (
        <div style={{
          margin: '0 12px',
          marginTop: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          borderRadius: 'var(--chat-radius)',
          padding: '4px 8px',
          backgroundColor: 'var(--chat-warning-muted)',
          border: '1px solid rgba(202, 138, 4, 0.3)',
        }}>
          <span style={{
            height: '6px',
            width: '6px',
            borderRadius: '50%',
            backgroundColor: 'var(--chat-warning)',
            animation: 'rickydata-chat-pulse 1.5s ease-in-out infinite',
          }} />
          <span style={{ fontSize: '10px', color: 'var(--chat-warning)' }}>
            Authenticating with gateway...
          </span>
        </div>
      )}
      {walletAddress && gatewayStatus === 'error' && gatewayError && (
        <div style={{
          margin: '0 12px',
          marginTop: '4px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          borderRadius: 'var(--chat-radius)',
          padding: '4px 8px',
          backgroundColor: 'var(--chat-error-muted)',
          border: '1px solid rgba(220, 38, 38, 0.3)',
        }}>
          <span style={{
            height: '6px',
            width: '6px',
            borderRadius: '50%',
            backgroundColor: 'var(--chat-error)',
          }} />
          <span style={{
            fontSize: '10px',
            color: 'var(--chat-error)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            Gateway: {gatewayError}
          </span>
        </div>
      )}

      {/* Main content */}
      {!walletAddress ? (
        <div style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}>
          <p style={{
            fontSize: 'var(--chat-font-size)',
            color: 'var(--chat-text-muted)',
            margin: 0,
          }}>
            Connect your wallet to chat.
          </p>
        </div>
      ) : engine.loading ? (
        <div style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}>
          <p style={{
            fontSize: 'var(--chat-font-size)',
            color: 'var(--chat-text-muted)',
            margin: 0,
          }}>
            Loading session...
          </p>
        </div>
      ) : mode === 'threads' ? (
        <ThreadDrawer
          threads={[]}
          activeThreadId={null}
          onSelectThread={async () => {}}
          onNewThread={async () => { builtInEngine.clearChat(); }}
        />
      ) : (
        <>
          <ChatMessageList
            messages={engine.messages}
            streaming={engine.streaming}
            onRevalidate={handleRevalidate}
          />

          {engine.error && (() => {
            const isQuota = /quota|402|insufficient/i.test(engine.error);
            if (isQuota) {
              return (
                <div style={{
                  margin: '0 12px 4px 12px',
                  borderRadius: 'var(--chat-radius)',
                  padding: '8px 12px',
                  backgroundColor: 'var(--chat-warning-muted)',
                  border: '1px solid rgba(202, 138, 4, 0.3)',
                }}>
                  <p style={{
                    margin: 0,
                    fontSize: '11px',
                    color: 'var(--chat-warning)',
                  }}>
                    {engine.error}
                  </p>
                </div>
              );
            }
            return (
              <div style={{
                margin: '0 12px 4px 12px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                borderRadius: 'var(--chat-radius)',
                padding: '6px 12px',
                backgroundColor: 'var(--chat-error-muted)',
              }}>
                <span style={{
                  flex: 1,
                  fontSize: '11px',
                  color: 'var(--chat-error)',
                }}>
                  {engine.error}
                </span>
                <button
                  type="button"
                  onClick={() => engine.clearError()}
                  style={{
                    flexShrink: 0,
                    fontWeight: 500,
                    fontSize: '11px',
                    fontFamily: 'var(--chat-font-family)',
                    textDecoration: 'underline',
                    color: 'var(--chat-error)',
                    backgroundColor: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Dismiss
                </button>
              </div>
            );
          })()}

          <ChatInputBar
            value={engine.input}
            onChange={engine.setInput}
            onSend={() => engine.sendMessage().catch(() => undefined)}
            disabled={engine.streaming}
            placeholder={engine.isContextual ? 'Ask about this context...' : 'Ask the assistant...'}
          />
        </>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes rickydata-chat-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
