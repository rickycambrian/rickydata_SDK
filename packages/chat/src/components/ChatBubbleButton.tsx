import { useChatBubble } from '../stores/bubble.js';

const styles = {
  button: {
    position: 'fixed' as const,
    bottom: '24px',
    right: '24px',
    zIndex: 40,
    display: 'flex',
    height: '52px',
    width: '52px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    backgroundColor: 'var(--chat-accent)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -4px rgba(0,0,0,0.2)',
    transition: 'transform 150ms ease',
  },
  badge: {
    position: 'absolute' as const,
    top: '-4px',
    right: '-4px',
    display: 'flex',
    height: '20px',
    minWidth: '20px',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '10px',
    backgroundColor: 'var(--chat-error)',
    padding: '0 4px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
  },
};

export function ChatBubbleButton() {
  const { open, unreadCount } = useChatBubble();

  return (
    <button
      type="button"
      onClick={open}
      data-testid="chat-bubble-button"
      style={styles.button}
      aria-label="Open chat"
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: '24px', height: '24px' }}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>

      {unreadCount > 0 && (
        <span style={styles.badge}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
