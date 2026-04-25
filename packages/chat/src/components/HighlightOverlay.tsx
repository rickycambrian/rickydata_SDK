import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAgentActions } from '../stores/actions.js';

export type HighlightOverlayCompanionVariant = 'orb' | 'clicky';

export interface HighlightOverlayProps {
  companionVariant?: HighlightOverlayCompanionVariant;
  showCompanion?: boolean;
  showHighlights?: boolean;
}

interface OverlayRect {
  target: string;
  top: number;
  left: number;
  width: number;
  height: number;
  tooltip?: string;
}

interface Point {
  x: number;
  y: number;
}

type ClickyMode = 'following' | 'flying' | 'pointing' | 'returning';

function clampBubbleLeft(pointerX: number, bubbleWidth: number) {
  const min = window.scrollX + 16;
  const max = window.scrollX + window.innerWidth - bubbleWidth - 16;
  return Math.max(min, Math.min(pointerX + 28, max));
}

function escapeSelector(value: string) {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

function resolveTargetElement(targetId: string | null | undefined) {
  if (!targetId) return null;
  const escaped = escapeSelector(targetId);
  return (
    document.querySelector<HTMLElement>(`[data-agent-id="${escaped}"]`)
    || document.querySelector<HTMLElement>(`[data-document-anchor="${escaped}"]`)
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

function targetPoint(rect: OverlayRect): Point {
  return {
    x: rect.left + Math.min(rect.width + 22, Math.max(20, rect.width * 0.75)),
    y: rect.top + Math.min(rect.height + 18, Math.max(24, rect.height * 0.45)),
  };
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
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

function ClickyTriangle({
  mode,
  rotation,
  status,
}: {
  mode: ClickyMode;
  rotation: number;
  status?: string;
}) {
  const pulseScale = mode === 'flying' || mode === 'returning' ? 1.14 : 1;
  return (
    <div
      className="absolute"
      style={{
        inset: 0,
        transform: `rotate(${rotation}deg) scale(${pulseScale})`,
        transformOrigin: '50% 58%',
        transition: mode === 'flying' || mode === 'returning' ? 'none' : 'transform 180ms ease-out',
        filter: 'drop-shadow(0 0 12px rgba(51,128,255,0.72)) drop-shadow(0 12px 26px rgba(5,12,26,0.34))',
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          clipPath: 'polygon(50% 0%, 2% 82%, 98% 82%)',
          background: 'linear-gradient(180deg, rgba(218,244,255,0.98) 0%, rgba(75,168,255,0.98) 44%, rgba(25,111,255,0.98) 100%)',
          border: '1px solid rgba(238, 250, 255, 0.86)',
          borderRadius: '12px',
          boxShadow: 'inset 0 0 12px rgba(255,255,255,0.48), inset 0 -12px 18px rgba(0,0,0,0.14)',
        }}
      />
      <div
        className="absolute inset-[5px]"
        style={{
          clipPath: 'polygon(50% 3%, 8% 76%, 92% 76%)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(130,214,255,0.12))',
        }}
      />
      {renderBuddyFace(status)}
    </div>
  );
}

function OrbCompanion({
  bubbleText,
  bubbleLeft,
  bubbleTop,
  cursorRotation,
  cursorX,
  cursorY,
  status,
}: {
  bubbleText?: string;
  bubbleLeft: number;
  bubbleTop: number;
  cursorRotation: number;
  cursorX: number;
  cursorY: number;
  status?: string;
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute z-[60] h-10 w-10 rounded-full border border-white/40"
        data-testid="rickydata-companion-orb"
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
        {renderBuddyFace(status)}
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
  );
}

function ClickyCompanion({
  bubbleText,
  cursorX,
  cursorY,
  focusRect,
  status,
}: {
  bubbleText?: string;
  cursorX: number;
  cursorY: number;
  focusRect: OverlayRect | null;
  status?: string;
}) {
  const [position, setPosition] = useState<Point>({ x: cursorX, y: cursorY });
  const [rotation, setRotation] = useState(-35);
  const [mode, setMode] = useState<ClickyMode>('following');
  const positionRef = useRef(position);
  const latestPointerRef = useRef<Point>({ x: cursorX, y: cursorY });
  const targetKeyRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    latestPointerRef.current = { x: cursorX, y: cursorY };
    if (mode === 'following') {
      setPosition({ x: cursorX, y: cursorY });
    }
  }, [cursorX, cursorY, mode]);

  useEffect(() => () => {
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!focusRect) {
      targetKeyRef.current = null;
      setMode('following');
      return;
    }

    const nextTargetKey = `${focusRect.target}:${Math.round(focusRect.left)}:${Math.round(focusRect.top)}:${Math.round(focusRect.width)}:${Math.round(focusRect.height)}`;
    if (targetKeyRef.current === nextTargetKey) return;
    targetKeyRef.current = nextTargetKey;

    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    if (timerRef.current) window.clearTimeout(timerRef.current);

    const animateTo = (destination: Point, nextMode: ClickyMode, onDone: () => void) => {
      const start = positionRef.current;
      const totalDistance = distance(start, destination);
      const duration = Math.min(Math.max(totalDistance / 800, 0.58), 1.25) * 1000;
      const startedAt = performance.now();
      const control = {
        x: (start.x + destination.x) / 2,
        y: (start.y + destination.y) / 2 - Math.min(totalDistance * 0.2, 92),
      };

      setMode(nextMode);
      const step = (now: number) => {
        const linear = Math.min(1, (now - startedAt) / duration);
        const t = linear * linear * (3 - (2 * linear));
        const oneMinusT = 1 - t;
        const x = (oneMinusT * oneMinusT * start.x) + (2 * oneMinusT * t * control.x) + (t * t * destination.x);
        const y = (oneMinusT * oneMinusT * start.y) + (2 * oneMinusT * t * control.y) + (t * t * destination.y);
        const tangentX = (2 * oneMinusT * (control.x - start.x)) + (2 * t * (destination.x - control.x));
        const tangentY = (2 * oneMinusT * (control.y - start.y)) + (2 * t * (destination.y - control.y));

        setPosition({ x, y });
        setRotation((Math.atan2(tangentY, tangentX) * 180) / Math.PI + 90);

        if (linear < 1) {
          frameRef.current = window.requestAnimationFrame(step);
          return;
        }

        setPosition(destination);
        onDone();
      };

      frameRef.current = window.requestAnimationFrame(step);
    };

    animateTo(targetPoint(focusRect), 'flying', () => {
      setRotation(-35);
      setMode('pointing');
      timerRef.current = setTimeout(() => {
        animateTo(latestPointerRef.current, 'returning', () => {
          setRotation(-35);
          setMode('following');
        });
      }, 2600);
    });
  }, [focusRect]);

  const visualStatus = mode === 'pointing' ? 'pointing' : status;
  const resolvedBubbleText = mode === 'pointing'
    ? focusRect?.tooltip || bubbleText || 'right here'
    : bubbleText;
  const bubbleWidth = resolvedBubbleText ? Math.min(300, Math.max(170, resolvedBubbleText.length * 6.4)) : 0;
  const bubbleLeft = resolvedBubbleText ? clampBubbleLeft(position.x, bubbleWidth) : position.x + 24;
  const bubbleTop = position.y + 10;

  return (
    <>
      <div
        className="pointer-events-none absolute z-[70]"
        data-testid="rickydata-companion-clicky"
        style={{
          top: position.y - 30,
          left: position.x - 16,
          width: 52,
          height: 52,
          animation: mode === 'following' || mode === 'pointing' ? 'rickydata-clicky-float 2.2s ease-in-out infinite' : undefined,
        }}
      >
        <ClickyTriangle mode={mode} rotation={rotation} status={visualStatus} />
      </div>

      <div
        className="pointer-events-none absolute z-[68] rounded-full"
        style={{
          top: position.y - 18,
          left: position.x - 18,
          width: 44,
          height: 44,
          background: 'radial-gradient(circle, rgba(51,128,255,0.32) 0%, rgba(51,128,255,0.10) 55%, rgba(51,128,255,0) 100%)',
          animation: 'rickydata-clicky-glow 2.1s ease-in-out infinite',
        }}
      />

      {resolvedBubbleText && (
        <div
          className="pointer-events-none absolute z-[72]"
          style={{
            top: bubbleTop,
            left: bubbleLeft,
            width: bubbleWidth,
            maxWidth: 300,
            borderRadius: 10,
            backgroundColor: 'rgba(17, 19, 22, 0.94)',
            border: '1px solid rgba(111, 172, 255, 0.32)',
            color: 'var(--chat-text-primary, #f7fbff)',
            fontFamily: 'var(--chat-font-family, system-ui, sans-serif)',
            fontSize: 12,
            lineHeight: 1.45,
            padding: '8px 10px',
            boxShadow: '0 16px 38px rgba(5, 12, 24, 0.32)',
          }}
        >
          {resolvedBubbleText}
        </div>
      )}
    </>
  );
}

/**
 * Portal-based UI highlight overlay.
 * Targets elements with data-agent-id or data-document-anchor attributes.
 */
export function HighlightOverlay({
  companionVariant = 'orb',
  showCompanion = true,
  showHighlights = true,
}: HighlightOverlayProps = {}) {
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
    if (!showHighlights || activeHighlights.size === 0) {
      setRects([]);
    }

    if (!showHighlights) return;

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
  }, [activeHighlights, showHighlights]);

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
    if (!showHighlights) return;

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
  }, [activeHighlights, removeHighlight, showHighlights]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const hasCursor = showCompanion && shadowCursor?.active && shadowCursor.pointer;
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
      {showHighlights && rects.map((rect) => (
        <div
          key={rect.target}
          className="pointer-events-none absolute z-50"
          data-testid="rickydata-highlight-ring"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            border: '2px solid var(--chat-warning, #facc15)',
            borderRadius: companionVariant === 'clicky' ? '10px' : '18px',
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
                borderRadius: companionVariant === 'clicky' ? 10 : '999px',
                backgroundColor: 'rgba(16, 20, 24, 0.94)',
                border: '1px solid rgba(250, 204, 21, 0.35)',
                padding: '6px 10px',
                fontSize: 11,
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
          data-testid="rickydata-focus-ring"
          style={{
            top: focusRect.top - 10,
            left: focusRect.left - 10,
            width: focusRect.width + 20,
            height: focusRect.height + 20,
            border: companionVariant === 'clicky'
              ? '1px dashed rgba(68, 139, 255, 0.72)'
              : '1px dashed rgba(255,255,255,0.75)',
            borderRadius: companionVariant === 'clicky' ? '14px' : '20px',
            boxShadow: companionVariant === 'clicky'
              ? '0 0 0 1px rgba(51,128,255,0.12), 0 0 24px rgba(51,128,255,0.14)'
              : '0 0 0 1px rgba(255,255,255,0.12)',
            animation: 'rickydata-chat-focus-ring 1.2s ease-in-out infinite',
          }}
        />
      )}

      {hasCursor && companionVariant === 'clicky' ? (
        <ClickyCompanion
          bubbleText={bubbleText}
          cursorX={cursorX}
          cursorY={cursorY}
          focusRect={focusRect}
          status={shadowCursor?.status}
        />
      ) : hasCursor ? (
        <OrbCompanion
          bubbleText={bubbleText}
          bubbleLeft={bubbleLeft}
          bubbleTop={bubbleTop}
          cursorRotation={cursorRotation}
          cursorX={cursorX}
          cursorY={cursorY}
          status={visualStatus}
        />
      ) : null}

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
        @keyframes rickydata-clicky-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes rickydata-clicky-glow {
          0%, 100% { opacity: 0.55; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.08); }
        }
      `}</style>
    </>,
    document.body,
  );
}
