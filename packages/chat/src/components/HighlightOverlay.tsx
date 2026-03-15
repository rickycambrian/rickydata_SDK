import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentActions } from '../stores/actions.js';

interface OverlayRect {
  target: string;
  top: number;
  left: number;
  width: number;
  height: number;
  tooltip?: string;
}

/**
 * Portal-based UI highlight overlay.
 * Targets elements with data-agent-id attribute.
 */
export function HighlightOverlay() {
  const activeHighlights = useAgentActions((s) => s.activeHighlights);
  const removeHighlight = useAgentActions((s) => s.removeHighlight);
  const [rects, setRects] = useState<OverlayRect[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Position overlays based on data-agent-id elements
  useEffect(() => {
    if (activeHighlights.size === 0) {
      setRects([]);
      return;
    }

    const computeRects = () => {
      const nextRects: OverlayRect[] = [];
      activeHighlights.forEach((highlight) => {
        const el = document.querySelector(`[data-agent-id="${highlight.target}"]`);
        if (!el) return;
        const rect = el.getBoundingClientRect();
        nextRects.push({
          target: highlight.target,
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height,
          tooltip: highlight.tooltip,
        });
      });
      setRects(nextRects);
    };

    computeRects();

    const observer = new ResizeObserver(() => computeRects());
    activeHighlights.forEach((highlight) => {
      const el = document.querySelector(`[data-agent-id="${highlight.target}"]`);
      if (el) observer.observe(el);
    });

    window.addEventListener('scroll', computeRects, true);
    window.addEventListener('resize', computeRects);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', computeRects, true);
      window.removeEventListener('resize', computeRects);
    };
  }, [activeHighlights]);

  // Auto-dismiss timers
  useEffect(() => {
    activeHighlights.forEach((highlight) => {
      if (timersRef.current.has(highlight.target)) return;
      const ms = highlight.durationMs ?? 3000;
      const delay = highlight.delayMs ?? 0;
      const timer = setTimeout(() => {
        removeHighlight(highlight.target);
        timersRef.current.delete(highlight.target);
      }, delay + ms);
      timersRef.current.set(highlight.target, timer);
    });

    timersRef.current.forEach((timer, target) => {
      if (!activeHighlights.has(target)) {
        clearTimeout(timer);
        timersRef.current.delete(target);
      }
    });
  }, [activeHighlights, removeHighlight]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  if (!mounted || rects.length === 0) return null;

  return createPortal(
    <>
      {rects.map((rect) => (
        <div
          key={rect.target}
          style={{
            position: 'absolute',
            zIndex: 50,
            pointerEvents: 'none',
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            border: '2px solid var(--chat-warning, #facc15)',
            borderRadius: 'var(--chat-radius)',
            boxShadow: '0 0 12px rgba(250, 204, 21, 0.4)',
            animation: 'rickydata-chat-highlight-pulse 1.5s ease-in-out infinite',
          }}
        >
          {rect.tooltip && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                top: rect.height + 12,
                whiteSpace: 'nowrap',
                borderRadius: 'var(--chat-radius)',
                backgroundColor: 'var(--chat-bg-secondary)',
                border: '1px solid rgba(250, 204, 21, 0.4)',
                padding: '4px 8px',
                fontSize: '11px',
                fontFamily: 'var(--chat-font-family)',
                color: 'var(--chat-warning)',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
                pointerEvents: 'none',
              }}
            >
              {rect.tooltip}
            </div>
          )}
        </div>
      ))}
      <style>{`
        @keyframes rickydata-chat-highlight-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(250, 204, 21, 0.4); }
          50% { box-shadow: 0 0 20px rgba(250, 204, 21, 0.7); }
        }
      `}</style>
    </>,
    document.body,
  );
}
