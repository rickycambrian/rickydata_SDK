import { useChatBubble, type ChatBubbleMode } from '../stores/bubble.js';
import { useChatBubbleConfig } from '../providers/ChatBubbleProvider.js';

export function ChatWindowHeader() {
  const { mode, setMode, minimize, close } = useChatBubble();
  const { config } = useChatBubbleConfig();

  const title = config.title ?? 'Chat Assistant';
  const modes = config.modes ?? ['chat', 'voice', 'threads'];

  const modeLabels: Record<ChatBubbleMode, string> = {
    chat: 'Chat',
    voice: 'Voice',
    threads: 'Threads',
    traces: 'Traces',
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      borderBottom: '1px solid var(--chat-border)',
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{
            margin: 0,
            fontSize: '14px',
            fontWeight: 600,
            fontFamily: 'var(--chat-font-family)',
            color: 'var(--chat-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={minimize}
            style={{
              display: 'flex',
              height: '28px',
              width: '28px',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--chat-radius)',
              color: 'var(--chat-text-muted)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 150ms ease',
            }}
            aria-label="Minimize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '16px', height: '16px' }}>
              <path d="M5 12h14" />
            </svg>
          </button>

          <button
            type="button"
            onClick={close}
            style={{
              display: 'flex',
              height: '28px',
              width: '28px',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--chat-radius)',
              color: 'var(--chat-text-muted)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 150ms ease',
            }}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: '16px', height: '16px' }}>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {modes.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {modes.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              style={{
                borderRadius: 'var(--chat-radius)',
                padding: '4px 10px',
                fontSize: 'var(--chat-font-size)',
                fontFamily: 'var(--chat-font-family)',
                fontWeight: mode === key ? 500 : 400,
                backgroundColor: mode === key ? 'var(--chat-accent-muted)' : 'transparent',
                color: mode === key ? 'var(--chat-accent)' : 'var(--chat-text-muted)',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 150ms ease, background-color 150ms ease',
              }}
            >
              {modeLabels[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
