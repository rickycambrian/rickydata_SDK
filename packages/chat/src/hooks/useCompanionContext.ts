import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useAgentActions } from '../stores/actions.js';
import type {
  CompanionContextSnapshot,
  CompanionTarget,
  DocumentAnchor,
} from '../types/chat.js';
import type { AgentTargetDescriptor } from '../types/host.js';

type BaseSnapshot = Omit<
  CompanionContextSnapshot,
  'hoverTarget' | 'pointer' | 'selectionText' | 'scrollDepth' | 'visibleAnchors' | 'visibleTargets'
>;

export interface UseCompanionContextOptions {
  surfaceRef: RefObject<HTMLElement>;
  snapshot: BaseSnapshot;
  onSnapshot?: (snapshot: CompanionContextSnapshot) => void;
  publishToStore?: boolean;
}

function parseVisibleTarget(element: HTMLElement): AgentTargetDescriptor | null {
  const id = element.dataset.agentId?.trim();
  if (!id) return null;
  const rect = element.getBoundingClientRect();
  const label =
    element.dataset.agentLabel?.trim()
    || element.getAttribute('aria-label')?.trim()
    || element.innerText?.trim().split(/\n+/)[0]
    || element.textContent?.trim().split(/\n+/)[0]
    || id;

  return {
    id,
    label,
    description: element.dataset.agentDescription?.trim() || undefined,
    role: element.dataset.agentRole?.trim() || undefined,
    visible: rect.width > 0 && rect.height > 0,
  };
}

function parseAnchor(element: HTMLElement): DocumentAnchor {
  return {
    id: element.dataset.documentAnchor || element.id,
    kind: (element.dataset.anchorKind as DocumentAnchor['kind']) || 'section',
    label:
      element.dataset.anchorLabel
      || element.getAttribute('aria-label')
      || element.textContent?.trim().slice(0, 120)
      || 'Untitled anchor',
    target: element.dataset.agentId || undefined,
    sectionId: element.dataset.sectionId || undefined,
    page: element.dataset.page ? Number(element.dataset.page) : undefined,
    textPreview: element.dataset.anchorPreview || undefined,
    metadata: undefined,
  };
}

function parseHoverTarget(element: EventTarget | null): CompanionTarget | null {
  if (!(element instanceof Element)) return null;
  const target = element.closest<HTMLElement>('[data-agent-id], [data-document-anchor]');
  if (!target) return null;

  return {
    id: target.dataset.agentId || target.dataset.documentAnchor || target.id || 'hover-target',
    target: target.dataset.agentId || undefined,
    anchorId: target.dataset.documentAnchor || undefined,
    label:
      target.dataset.anchorLabel
      || target.dataset.agentLabel
      || target.getAttribute('aria-label')
      || undefined,
    panel: target.dataset.panel || undefined,
    tooltip: target.dataset.anchorPreview || target.dataset.agentDescription || undefined,
  };
}

export function useCompanionContext({
  onSnapshot,
  publishToStore = true,
  snapshot,
  surfaceRef,
}: UseCompanionContextOptions) {
  const latestHoverTargetRef = useRef<CompanionTarget | null>(null);
  const latestPointerRef = useRef<CompanionContextSnapshot['pointer']>(null);
  const latestSelectionRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<CompanionContextSnapshot>(() => ({
    ...snapshot,
    visibleAnchors: [],
    visibleTargets: [],
    hoverTarget: null,
    pointer: null,
    selectionText: undefined,
    scrollDepth: 0,
  }));

  const staticSnapshot = useMemo(() => snapshot, [snapshot]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const buildSnapshot = (): CompanionContextSnapshot => {
      const visibleAnchors = Array.from(surface.querySelectorAll<HTMLElement>('[data-document-anchor]'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom >= 0 && rect.top <= window.innerHeight;
        })
        .map(parseAnchor);

      const visibleTargets = Array.from(surface.querySelectorAll<HTMLElement>('[data-agent-id]'))
        .map(parseVisibleTarget)
        .filter((entry): entry is AgentTargetDescriptor => entry !== null);

      const scrollRoot = surface.querySelector<HTMLElement>('[data-companion-scroll-root]') || surface;
      const scrollable = scrollRoot.scrollHeight > scrollRoot.clientHeight;
      const scrollDepth = scrollable
        ? Math.min(
            1,
            scrollRoot.scrollTop / Math.max(1, scrollRoot.scrollHeight - scrollRoot.clientHeight),
          )
        : 0;

      return {
        ...staticSnapshot,
        visibleAnchors,
        visibleTargets,
        hoverTarget: latestHoverTargetRef.current,
        pointer: latestPointerRef.current,
        selectionText: latestSelectionRef.current || undefined,
        scrollDepth,
      };
    };

    const publishSnapshot = () => {
      rafRef.current = null;
      const nextSnapshot = buildSnapshot();
      setLatestSnapshot(nextSnapshot);
      if (publishToStore) {
        useAgentActions.getState().setLatestContext(nextSnapshot);
      }
      onSnapshot?.(nextSnapshot);
    };

    const schedulePublish = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(publishSnapshot);
    };

    const handlePointerMove = (event: MouseEvent | PointerEvent) => {
      const rect = surface.getBoundingClientRect();
      const insideApp =
        event.clientX >= rect.left
        && event.clientX <= rect.right
        && event.clientY >= rect.top
        && event.clientY <= rect.bottom;
      latestPointerRef.current = {
        viewportX: event.clientX,
        viewportY: event.clientY,
        documentX: event.clientX + window.scrollX,
        documentY: event.clientY + window.scrollY,
        insideApp,
        updatedAt: new Date().toISOString(),
      };
      latestHoverTargetRef.current = parseHoverTarget(event.target);
      schedulePublish();
    };

    const handleSelection = () => {
      latestSelectionRef.current = window.getSelection?.()?.toString().trim() || '';
      schedulePublish();
    };

    const handleViewportChange = () => schedulePublish();

    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('mousemove', handlePointerMove, { passive: true });
    document.addEventListener('selectionchange', handleSelection);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    schedulePublish();

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('mousemove', handlePointerMove);
      document.removeEventListener('selectionchange', handleSelection);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [onSnapshot, publishToStore, staticSnapshot, surfaceRef]);

  return latestSnapshot;
}
