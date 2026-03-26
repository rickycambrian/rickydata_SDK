import { useState, useCallback, useRef, useEffect } from 'react';

export interface ChatImage {
  data: string;
  mediaType: string;
  preview: string;
}

export interface ChatInputProps {
  onSend: (text: string, images?: ChatImage[]) => void;
  sending?: boolean;
  placeholder?: string;
  disabled?: boolean;
  maxImages?: number;
}

const MAX_IMAGE_SIZE = 600_000;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Chat input with auto-resize textarea, image picker, paste handler,
 * image preview thumbnails with remove, and send button with loading state.
 */
export function ChatInput({
  onSend,
  sending = false,
  placeholder = 'Send a message...',
  disabled = false,
  maxImages = 5,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_IMAGE_SIZE) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        setImages(prev =>
          prev.length >= maxImages
            ? prev
            : [...prev, { data: base64, mediaType: file.type, preview: dataUrl }],
        );
      };
      reader.readAsDataURL(file);
    }
  }, [maxImages]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      imageFiles.forEach(f => dt.items.add(f));
      processFiles(dt.files);
    }
  }, [processFiles]);

  const handleRemoveImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(() => {
    if ((!input.trim() && images.length === 0) || sending || disabled) return;
    onSend(input.trim(), images.length > 0 ? images : undefined);
    setInput('');
    setImages([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, images, sending, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const isDisabled = sending || disabled;
  const canSend = (input.trim() || images.length > 0) && !isDisabled;

  return (
    <div style={{
      borderTop: '1px solid var(--chat-border, rgba(0,0,0,0.1))',
      padding: '12px 16px',
      flexShrink: 0,
      backgroundColor: 'var(--chat-bg, #fff)',
    }}>
      {/* Image previews */}
      {images.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '8px',
          flexWrap: 'wrap',
          maxWidth: '768px',
          margin: '0 auto 8px',
        }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={img.preview}
                alt={`Upload ${i + 1}`}
                style={{
                  width: '56px',
                  height: '56px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  border: '1px solid var(--chat-border, rgba(0,0,0,0.1))',
                }}
              />
              <button
                type="button"
                onClick={() => handleRemoveImage(i)}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  backgroundColor: '#374151',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label={`Remove image ${i + 1}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: '8px',
        maxWidth: '768px',
        margin: '0 auto',
        alignItems: 'flex-end',
      }}>
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={e => { processFiles(e.target.files); e.target.value = ''; }}
        />

        {/* Image picker button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled || images.length >= maxImages}
          title={images.length >= maxImages ? `Max ${maxImages} images` : 'Attach image'}
          style={{
            padding: '8px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--chat-text-muted, #9ca3af)',
            cursor: isDisabled || images.length >= maxImages ? 'default' : 'pointer',
            opacity: isDisabled || images.length >= maxImages ? 0.3 : 1,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'opacity 150ms',
          }}
          aria-label="Attach image"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          placeholder={placeholder}
          disabled={isDisabled}
          style={{
            flex: 1,
            resize: 'none',
            overflow: 'hidden',
            borderRadius: '12px',
            border: '1px solid var(--chat-border, rgba(0,0,0,0.1))',
            backgroundColor: 'var(--chat-bg-secondary, #f9fafb)',
            padding: '10px 16px',
            fontSize: 'var(--chat-font-size, 14px)',
            fontFamily: 'inherit',
            color: 'var(--chat-text, #111827)',
            outline: 'none',
            opacity: isDisabled ? 0.5 : 1,
            transition: 'border-color 150ms, opacity 150ms',
            lineHeight: 1.5,
          }}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          style={{
            padding: '10px',
            borderRadius: '12px',
            border: 'none',
            backgroundColor: canSend ? 'var(--chat-accent, #6366f1)' : 'var(--chat-bg-secondary, #e5e7eb)',
            color: canSend ? '#fff' : 'var(--chat-text-muted, #9ca3af)',
            cursor: canSend ? 'pointer' : 'default',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 150ms, color 150ms',
          }}
        >
          {sending ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ animation: 'rickydata-chat-spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4zM22 2 11 13" />
            </svg>
          )}
        </button>
      </div>

      <style>{`
        @keyframes rickydata-chat-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
