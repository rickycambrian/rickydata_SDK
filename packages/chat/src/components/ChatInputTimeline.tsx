import React, { useState, useRef, useCallback } from 'react';
import type { ChatImage } from '@rickydata/react';

export interface ChatInputTimelineProps {
  /** Called when the user submits a message. */
  onSend: (text: string, options?: { images?: ChatImage[] }) => void;
  /** Disables the input and send button. */
  disabled?: boolean;
  /** Whether a message is currently being sent (shows spinner). */
  sending?: boolean;
  /** Placeholder text. */
  placeholder?: string;
  /** Maximum number of image attachments (default: 5). */
  maxImages?: number;
}

function readFileAsDataURL(file: File): Promise<ChatImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      resolve({ data: base64, mediaType: file.type || 'image/png', preview: result });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Full-page Tailwind-styled chat input with image attachments, paste support,
 * and auto-resizing textarea. Matches the marketplace AgentChat input area.
 */
export function ChatInputTimeline({
  onSend,
  disabled = false,
  sending = false,
  placeholder = 'Send a message...',
  maxImages = 5,
}: ChatInputTimelineProps) {
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    onSend(text, pendingImages.length > 0 ? { images: pendingImages } : undefined);
    setInput('');
    setPendingImages([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, pendingImages, onSend]);

  const handleImageSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const remaining = maxImages - pendingImages.length;
    const toProcess = Array.from(files).slice(0, remaining);
    const images = await Promise.all(toProcess.map(readFileAsDataURL));
    setPendingImages(prev => [...prev, ...images]);
  }, [pendingImages.length, maxImages]);

  const handleRemoveImage = useCallback((index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      const remaining = maxImages - pendingImages.length;
      const toProcess = imageFiles.slice(0, remaining);
      const images = await Promise.all(toProcess.map(readFileAsDataURL));
      setPendingImages(prev => [...prev, ...images]);
    }
  }, [pendingImages.length, maxImages]);

  const isDisabled = disabled || sending;
  const canSend = !isDisabled && (input.trim().length > 0 || pendingImages.length > 0);

  return (
    <div className="border-t border-surface-200/60 dark:border-surface-800/60 px-4 sm:px-6 py-3 flex-shrink-0 bg-white/80 dark:bg-surface-950/80 backdrop-blur-sm">
      {/* Image previews */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap max-w-3xl mx-auto">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img.preview} alt={`Upload ${i + 1}`} className="w-14 h-14 object-cover rounded-lg border border-surface-200 dark:border-surface-700" />
              <button
                onClick={() => handleRemoveImage(i)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-surface-800 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2 max-w-3xl mx-auto items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={e => { handleImageSelect(e.target.files); e.target.value = ''; }}
        />

        {/* Image attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled || pendingImages.length >= maxImages}
          className="p-2 rounded-lg text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-30 transition-colors shrink-0"
          title={pendingImages.length >= maxImages ? `Max ${maxImages} images` : 'Attach image'}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="10" y1="10" x2="14" y2="10" />
          </svg>
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) handleSend();
            }
          }}
          onPaste={handlePaste}
          onInput={e => {
            const el = e.target as HTMLTextAreaElement;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 120) + 'px';
          }}
          rows={1}
          placeholder={placeholder}
          disabled={isDisabled}
          className="flex-1 bg-surface-50 dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500/30 disabled:opacity-50 text-surface-900 dark:text-surface-100 placeholder:text-surface-400 resize-none overflow-hidden font-[inherit] transition-colors"
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="p-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white disabled:bg-surface-200 dark:disabled:bg-surface-700 disabled:text-surface-400 transition-colors shrink-0"
        >
          {sending ? (
            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
