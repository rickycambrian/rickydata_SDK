import { useEffect, useMemo, useRef, useState } from 'react';
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

function clampBubbleLeft(pointerX: number, bubbleWidth: number) {
  const min = window.scrollX + 16;
  const max = window.scrollX + window.innerWidth - bubbleWidth - 16;
  return Math.max(min, Math.min(pointerX + 28, max));
}

function resolveTargetElement(targetId: string | null | undefined) {
  if (!targetId) return null;
  return (
    document.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(targetId)}"]`)
    || document.querySelector<HTMLElement>(`[data-document-anchor="${CSS.escape(targetId)}"]`)
    || document.getElementById(targetId)
  );
}

function getBuddyRotationDegrees(
  cursorX: number,
  cursorY: number,
  focusRect: OverlayRect | null,
  status?: string,
) {
  if (!focusRect || status !== 'pointing') {
    return -35;
  }

  const targetX = focusRect.left + (focusRect.width / 2);
  const targetY = focusRect.top + (focusRect.height / 2);
  return (Math.atan2(targetY - cursorY, targetX - cursorX) * 180) / Math.PI + 90;
}

function renderBuddyFace(status?: string) {
  switch (status) {
    case 'listening':
      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-end gap-[3px]">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="block w-[3px] rounded-full bg-white/95"
                style={{
                  height: `${10 + (index % 2 === 0 ? 6 : 12)}px`,
                  animation: `rickydata-companion-wave ${0.7 + (index * 0.08)}s ease-in-out ${index * 0.08}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      );
    case 'processing':
      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="block h-5 w-5 rounded-full border-2 border-white/20 border-t-white/95 animate-spin" />
        </div>
      );
    case 'responding':
      return (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="block h-3.5 w-3.5 rounded-full bg-white/95 shadow-[0_0_20px_rgba(255,255,255,0.9)] animate-pulse" />
        </div>
      );
    default:
      return null;
  }
}

/**
 * Portal-based UI highlight overlay.
 * Targets elements with data-agent-id or data-document-anchor attributes.
 */
export function HighlightOverlay() {
  const activeHighlights = useAgentActions((s) => s.activeHighlights);
  const removeHighlight = useAgentActions((s) => s.removeHighlight);
  const focusedTarget = useAgentActions((s) => s.focusedTarget);
  const shadowCursor = useAgentActions((s) => s.shadowCursor);
  const [rects, setRects] = useState<OverlayRect[]>([]);
  const [focusRect, setFocusRect] = useState<OverlayRect | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (activeHighlights.size === 0) {
      setRects([]);
    }

    const computeRects = () => {
      const nextRects: OverlayRect[] = [];
      activeHighlights.forEach((highlight) => {
        const el = resolveTargetElement(highlight.target);
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

    if (activeHighlights.size === 0) {
      return;
    }

    const observer = new ResizeObserver(() => computeRects());
    activeHighlights.forEach((highlight) => {
      const el = resolveTargetElement(highlight.target);
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

  useEffect(() => {
    const targetId = focusedTarget?.target || focusedTarget?.anchorId || focusedTarget?.id;
    if (!targetId) {
      setFocusRect(null);
      return;
    }

    const computeFocusRect = () => {
      const el = resolveTargetElement(targetId);
      if (!el) {
        setFocusRect(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setFocusRect({
        target: targetId,
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
        tooltip: focusedTarget?.tooltip || focusedTarget?.label,
      });
    };

    computeFocusRect();

    const el = resolveTargetElement(targetId);
    const observer = new ResizeObserver(() => computeFocusRect());
    if (el) observer.observe(el);
    window.addEventListener('scroll', computeFocusRect, true);
    window.addEventListener('resize', computeFocusRect);

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', computeFocusRect, true);
      window.removeEventListener('resize', computeFocusRect);
    };
  }, [focusedTarget]);

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

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const hasCursor = shadowCursor?.active && shadowCursor.pointer;
  const cursorX = shadowCursor?.pointer?.documentX ?? shadowCursor?.pointer?.viewportX ?? 0;
  const cursorY = shadowCursor?.pointer?.documentY ?? shadowCursor?.pointer?.viewportY ?? 0;
  const visualStatus = focusRect ? 'pointing' : shadowCursor?.status;
  const bubbleText = useMemo(() => {
    if (focusRect?.tooltip) return focusRect.tooltip;
    return shadowCursor?.tooltip || shadowCursor?.label;
  }, [focusRect?.tooltip, shadowCursor?.label, shadowCursor?.tooltip]);
  const bubbleWidth = bubbleText ? Math.min(288, Math.max(190, bubbleText.length * 6.6)) : 0;
  const bubbleLeft = bubbleText ? clampBubbleLeft(cursorX, bubbleWidth) : cursorX + 28;
  const bubbleTop = cursorY + 10;
  const cursorRotation = getBuddyRotationDegrees(cursorX, cursorY, focusRect, visualStatus);

  if (!mounted || (rects.length === 0 && !focusRect && !hasCursor)) return null;

  return createPortal(
    <>
      {rects.map((rect) => (
        <div
          key={rect.target}
          className="pointer-events-none absolute z-50"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            border: '2px solid var(--chat-warning, #facc15)',
            borderRadius: '18px',
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
                borderRadius: '999px',
                backgroundColor: 'rgba(16, 20, 24, 0.94)',
                border: '1px solid rgba(250, 204, 21, 0.35)',
                padding: '6px 10px',
                fontSize: '11px',
                fontFamily: 'var(--chat-font-family)',
                color: 'var(--chat-warning, #facc15)',
                boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
              }}
            >
              {rect.tooltip}
            </div>
          )}
        </div>
      ))}

      {focusRect && (
        <div
          className="pointer-events-none absolute z-[55]"
          style={{
            top: focusRect.top - 10,
            left: focusRect.left - 10,
            width: focusRect.width + 20,
            height: focusRect.height + 20,
            border: '1px dashed rgba(255,255,255,0.75)',
            borderRadius: '20px',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.12)',
            animation: 'rickydata-chat-focus-ring 1.2s ease-in-out infinite',
          }}
        />
      )}

      {hasCursor && (
        <>
          <div
            className="pointer-events-none absolute z-[60] h-10 w-10 rounded-full border border-white/40"
            style={{
              top: cursorY - 18,
              left: cursorX - 18,
              background: 'linear-gradient(135deg, rgba(74, 201, 255, 0.98), rgba(32, 102, 255, 0.88))',
              boxShadow: '0 16px 32px rgba(9, 18, 36, 0.34)',
            }}
          >
            <div
              className="absolute left-1/2 top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/95 transition-transform duration-300"
              style={{ transform: `translate(-50%, -50%) rotate(${cursorRotation}deg)` }}
            />
            {renderBuddyFace(visualStatus)}
          </div>

          {bubbleText && (
            <div
              className="pointer-events-none absolute z-[61]"
              style={{
                top: bubbleTop,
                left: bubbleLeft,
                maxWidth: '18rem',
                borderRadius: '18px',
                backgroundColor: 'rgba(16, 20, 24, 0.94)',
                border: '1px solid rgba(143, 210, 255, 0.3)',
                color: 'var(--chat-text-primary)',
                fontFamily: 'var(--chat-font-family)',
                fontSize: '12px',
                lineHeight: 1.45,
                padding: '9px 12px',
                boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
              }}
            >
              {bubbleText}
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes rickydata-chat-highlight-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(250, 204, 21, 0.4); }
          50% { box-shadow: 0 0 20px rgba(250, 204, 21, 0.7); }
        }
        @keyframes rickydata-chat-focus-ring {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.015); opacity: 1; }
        }
        @keyframes rickydata-companion-wave {
          0%, 100% { transform: scaleY(0.55); opacity: 0.7; }
          50% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </>,
    document.body,
  );
}
