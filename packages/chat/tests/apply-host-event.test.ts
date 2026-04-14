import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHostEvent } from '../src/host/apply.js';
import { useAgentActions } from '../src/stores/actions.js';

describe('applyHostEvent', () => {
  beforeEach(() => {
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
  });

  it('routes highlights and focus events through the shared store and host adapter', () => {
    const scrollToTarget = vi.fn();

    applyHostEvent(
      {
        type: 'ui_highlight',
        data: { target: 'notebook.run-all', tooltip: 'Run the notebook' },
      },
      {
        host: {
          getContextSnapshot: () => ({ route: '/notebook', view: 'notebook' }),
          scrollToTarget,
        },
      },
    );

    applyHostEvent(
      {
        type: 'focus_target',
        data: {
          id: 'run-all-button',
          target: 'notebook.run-all',
          label: 'Run all',
        },
      },
      {
        host: {
          getContextSnapshot: () => ({ route: '/notebook', view: 'notebook' }),
          scrollToTarget,
        },
      },
    );

    const state = useAgentActions.getState();
    expect(state.activeHighlights.get('notebook.run-all')).toMatchObject({
      target: 'notebook.run-all',
    });
    expect(state.focusedTarget).toMatchObject({
      target: 'notebook.run-all',
    });
    expect(scrollToTarget).toHaveBeenNthCalledWith(1, 'notebook.run-all');
    expect(scrollToTarget).toHaveBeenNthCalledWith(2, 'notebook.run-all');
  });

  it('propagates context and readiness changes', () => {
    const onContextChange = vi.fn();
    const onReviewReadyChange = vi.fn();

    applyHostEvent(
      {
        type: 'review_ready',
        data: {
          title: 'Review ready',
          count: 3,
        },
      },
      {
        onReviewReadyChange,
      },
    );

    applyHostEvent(
      {
        type: 'app_context',
        data: {
          route: '/research/paper-1',
          stage: 'studying',
          visibleAnchors: [],
          visibleTargets: [{ id: 'claims-panel', label: 'Claims panel', visible: true }],
          openPanel: 'claims',
        },
      },
      {
        onContextChange,
      },
    );

    const state = useAgentActions.getState();
    expect(state.reviewReady).toMatchObject({ title: 'Review ready', count: 3 });
    expect(state.latestContext).toMatchObject({
      route: '/research/paper-1',
      openPanel: 'claims',
    });
    expect(state.openPanel).toBe('claims');
    expect(onReviewReadyChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Review ready', count: 3 }),
    );
    expect(onContextChange).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/research/paper-1', openPanel: 'claims' }),
    );
  });
});
