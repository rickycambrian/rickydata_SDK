// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HighlightOverlay } from '../src/components/HighlightOverlay.js';
import { useAgentActions } from '../src/stores/actions.js';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

function resetAgentActions() {
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
}

function addTarget(id: string, rect: Partial<DOMRect> = {}) {
  const el = document.createElement('button');
  el.dataset.agentId = id;
  el.textContent = id;
  el.getBoundingClientRect = vi.fn(() => ({
    x: rect.x ?? rect.left ?? 80,
    y: rect.y ?? rect.top ?? 120,
    top: rect.top ?? 120,
    left: rect.left ?? 80,
    bottom: rect.bottom ?? 160,
    right: rect.right ?? 260,
    width: rect.width ?? 180,
    height: rect.height ?? 40,
    toJSON: () => ({}),
  } as DOMRect));
  document.body.appendChild(el);
  return el;
}

describe('HighlightOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetAgentActions();
    vi.useRealTimers();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  it('renders the default orb companion for backward compatibility', async () => {
    useAgentActions.getState().setShadowCursor({
      active: true,
      status: 'idle',
      label: 'Ready',
      pointer: {
        viewportX: 120,
        viewportY: 140,
        documentX: 120,
        documentY: 140,
        insideApp: true,
        updatedAt: new Date().toISOString(),
      },
    });

    render(<HighlightOverlay />);

    expect(await screen.findByTestId('rickydata-companion-orb')).toBeTruthy();
    expect(screen.queryByTestId('rickydata-companion-clicky')).toBeNull();
  });

  it('renders the clicky companion variant at the pointer location', async () => {
    useAgentActions.getState().setShadowCursor({
      active: true,
      status: 'listening',
      label: 'Listening',
      pointer: {
        viewportX: 220,
        viewportY: 180,
        documentX: 220,
        documentY: 180,
        insideApp: true,
        updatedAt: new Date().toISOString(),
      },
    });

    render(<HighlightOverlay companionVariant="clicky" />);

    const clicky = await screen.findByTestId('rickydata-companion-clicky');
    expect(clicky).toBeTruthy();
    expect(clicky.getAttribute('style')).toContain('top: 150px');
    expect(clicky.getAttribute('style')).toContain('left: 204px');
  });

  it('resolves focused targets and shows the clicky focus ring', async () => {
    addTarget('claim-1', { top: 90, left: 70, width: 220, height: 64 });
    useAgentActions.getState().setShadowCursor({
      active: true,
      status: 'idle',
      label: 'Ready',
      pointer: {
        viewportX: 40,
        viewportY: 50,
        documentX: 40,
        documentY: 50,
        insideApp: true,
        updatedAt: new Date().toISOString(),
      },
    });
    useAgentActions.getState().setFocusedTarget({
      id: 'claim-1',
      target: 'claim-1',
      label: 'Claim source',
    });

    render(<HighlightOverlay companionVariant="clicky" />);

    expect(await screen.findByTestId('rickydata-focus-ring')).toBeTruthy();
    expect(await screen.findByTestId('rickydata-companion-clicky')).toBeTruthy();
    expect(screen.getByText('Claim source')).toBeTruthy();
  });

  it('can render highlights without the companion', async () => {
    addTarget('approve-paper', { top: 20, left: 30, width: 100, height: 32 });
    useAgentActions.getState().addHighlight({
      target: 'approve-paper',
      tooltip: 'Approve here',
    });

    render(<HighlightOverlay showCompanion={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('rickydata-highlight-ring')).toBeTruthy();
    });
    expect(screen.queryByTestId('rickydata-companion-orb')).toBeNull();
    expect(screen.getByText('Approve here')).toBeTruthy();
  });
});
