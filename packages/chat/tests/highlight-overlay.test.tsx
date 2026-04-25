// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HighlightOverlay } from '../src/components/HighlightOverlay.js';
import { applyHostEvent } from '../src/host/apply.js';
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
    expect(clicky.getAttribute('style')).toContain('top: 197px');
    expect(clicky.getAttribute('style')).toContain('left: 247px');
    expect(clicky.getAttribute('style')).toContain('width: 16px');
    expect(clicky.getAttribute('style')).toContain('height: 16px');
    expect(screen.getByTestId('rickydata-companion-clicky-triangle').getAttribute('style')).toContain('background: rgb(51, 128, 255)');
  });

  it('renders the clicky companion from browser pointer movement without store context', async () => {
    render(<HighlightOverlay companionVariant="clicky" />);

    document.dispatchEvent(new MouseEvent('pointermove', {
      bubbles: true,
      clientX: 100,
      clientY: 120,
    }));

    const clicky = await screen.findByTestId('rickydata-companion-clicky');
    expect(clicky.getAttribute('style')).toContain('top: 137px');
    expect(clicky.getAttribute('style')).toContain('left: 127px');
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('applies host highlight and focus events to visible page targets', async () => {
    addTarget('claims-section', { top: 44, left: 52, width: 320, height: 96 });

    applyHostEvent({
      type: 'ui_highlight',
      data: {
        target: 'claims-section',
        tooltip: 'Claims section',
        durationMs: 5000,
      },
    });
    applyHostEvent({
      type: 'focus_target',
      data: {
        id: 'claims-section',
        target: 'claims-section',
        label: 'Claims section',
      },
    });

    render(<HighlightOverlay companionVariant="clicky" showCompanion={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('rickydata-highlight-ring')).toBeTruthy();
      expect(screen.getByTestId('rickydata-focus-ring')).toBeTruthy();
    });
    expect(screen.getByText('Claims section')).toBeTruthy();
    expect(useAgentActions.getState().activeHighlights.get('claims-section')).toMatchObject({
      target: 'claims-section',
      tooltip: 'Claims section',
    });
    expect(useAgentActions.getState().focusedTarget).toMatchObject({
      target: 'claims-section',
      label: 'Claims section',
    });
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
