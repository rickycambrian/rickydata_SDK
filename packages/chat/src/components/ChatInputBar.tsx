import { useCallback, useRef, useEffect } from 'react';

export interface ChatInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInputBar({ value, onChange, onSend, disabled, placeholder }: ChatInputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  return (
    <div style={{
      borderTop: '1px solid var(--chat-border)',
      padding: '8px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Ask a question...'}
          rows={1}
          disabled={disabled}
          style={{
            flex: 1,
            resize: 'none',
            borderRadius: 'var(--chat-radius)',
            border: '1px solid var(--chat-border)',
            backgroundColor: 'var(--chat-bg)',
            padding: '8px 12px',
            fontSize: 'var(--chat-font-size)',
            fontFamily: 'var(--chat-font-family)',
            color: 'var(--chat-text)',
            outline: 'none',
            opacity: disabled ? 0.6 : 1,
          }}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !value.trim()}
          data-testid="chat-send-button"
          aria-label="Send message"
          style={{
            display: 'flex',
            height: '32px',
            width: '32px',
            flexShrink: 0,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--chat-radius)',
            backgroundColor: 'var(--chat-accent)',
            color: '#fff',
            border: 'none',
            cursor: disabled || !value.trim() ? 'default' : 'pointer',
            opacity: disabled || !value.trim() ? 0.5 : 1,
            transition: 'opacity 150ms ease',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ width: '16px', height: '16px' }}
          >
            <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
