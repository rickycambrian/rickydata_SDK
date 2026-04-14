// @vitest-environment jsdom

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef, type RefObject } from 'react';
import { useCompanionContext } from '../src/hooks/useCompanionContext.js';
import { useAgentActions } from '../src/stores/actions.js';

function TestHarness({
  onSnapshot,
  surfaceRef,
}: {
  onSnapshot: (snapshot: unknown) => void;
  surfaceRef: RefObject<HTMLDivElement>;
}) {
  useCompanionContext({
    surfaceRef,
    snapshot: {
      route: '/notebook',
      view: 'notebook',
      title: 'Companion Demo',
    },
    onSnapshot: (snapshot) => onSnapshot(snapshot),
  });
  return null;
}

describe('useCompanionContext', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('PointerEvent', MouseEvent);
    useAgentActions.setState({
      activeHighlights: new Map(),
      pendingActions: new Map(),
      completedActions: [],
      focusedTarget: null,
      openPanel: null,
      shadowCursor: null,
      reviewReady: null,
      packageReady: null,
      latestContext: null,
    });
    document.body.innerHTML = '';
  });

  it('captures visible targets, anchors, pointer state, and publishes to the shared store', async () => {
    const surface = document.createElement('div');
    surface.innerHTML = `
      <div data-agent-id="notebook.run-all" data-agent-label="Run all"></div>
      <section data-document-anchor="section-1" data-anchor-kind="section" data-anchor-label="Introduction"></section>
    `;
    document.body.appendChild(surface);
    const surfaceRef = createRef<HTMLDivElement>();
    surfaceRef.current = surface as HTMLDivElement;
    const onSnapshot = vi.fn();
    render(<TestHarness onSnapshot={onSnapshot} surfaceRef={surfaceRef} />);

    fireEvent.mouseMove(document, {
      clientX: 24,
      clientY: 36,
    });

    await waitFor(() => {
      const latest = useAgentActions.getState().latestContext;
      expect(latest).toBeTruthy();
      expect(latest?.visibleTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'notebook.run-all', label: 'Run all' }),
        ]),
      );
      expect(latest?.visibleAnchors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'section-1', label: 'Introduction' }),
        ]),
      );
      expect(onSnapshot).toHaveBeenCalled();
    });
  });
});
