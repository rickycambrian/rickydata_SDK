import { create } from 'zustand';
import type { ActionProposal, HighlightTarget } from '../types/actions.js';
import type {
  CompanionContextSnapshot,
  CompanionCursorShadow,
  CompanionReadinessState,
  CompanionTarget,
} from '../types/chat.js';

interface AgentActionsState {
  activeHighlights: Map<string, HighlightTarget>;
  pendingActions: Map<string, ActionProposal>;
  completedActions: ActionProposal[];
  focusedTarget: CompanionTarget | null;
  openPanel: string | null;
  shadowCursor: CompanionCursorShadow | null;
  reviewReady: CompanionReadinessState | null;
  packageReady: CompanionReadinessState | null;
  latestContext: CompanionContextSnapshot | null;

  addHighlight: (highlight: HighlightTarget) => void;
  removeHighlight: (target: string) => void;
  clearHighlights: () => void;

  addPendingAction: (action: ActionProposal) => void;
  removePendingAction: (proposalId: string) => void;
  completeAction: (action: ActionProposal) => void;
  clearCompleted: () => void;

  setFocusedTarget: (target: CompanionTarget | null) => void;
  setOpenPanel: (panel: string | null) => void;
  setShadowCursor: (shadow: CompanionCursorShadow | null) => void;
  setReviewReady: (state: CompanionReadinessState | null) => void;
  setPackageReady: (state: CompanionReadinessState | null) => void;
  setLatestContext: (context: CompanionContextSnapshot | null) => void;
  clearCompanionState: () => void;
}

export const useAgentActions = create<AgentActionsState>((set) => ({
  activeHighlights: new Map(),
  pendingActions: new Map(),
  completedActions: [],
  focusedTarget: null,
  openPanel: null,
  shadowCursor: null,
  reviewReady: null,
  packageReady: null,
  latestContext: null,

  addHighlight: (highlight) =>
    set((state) => {
      const next = new Map(state.activeHighlights);
      next.set(highlight.target, highlight);
      return { activeHighlights: next };
    }),

  removeHighlight: (target) =>
    set((state) => {
      const next = new Map(state.activeHighlights);
      next.delete(target);
      return { activeHighlights: next };
    }),

  clearHighlights: () => set({ activeHighlights: new Map() }),

  addPendingAction: (action) =>
    set((state) => {
      const next = new Map(state.pendingActions);
      next.set(action.proposalId, action);
      return { pendingActions: next };
    }),

  removePendingAction: (proposalId) =>
    set((state) => {
      const next = new Map(state.pendingActions);
      next.delete(proposalId);
      return { pendingActions: next };
    }),

  completeAction: (action) =>
    set((state) => {
      const next = new Map(state.pendingActions);
      next.delete(action.proposalId);
      return {
        pendingActions: next,
        completedActions: [...state.completedActions, action],
      };
    }),

  clearCompleted: () => set({ completedActions: [] }),

  setFocusedTarget: (focusedTarget) => set({ focusedTarget }),
  setOpenPanel: (openPanel) => set({ openPanel }),
  setShadowCursor: (shadowCursor) => set({ shadowCursor }),
  setReviewReady: (reviewReady) => set({ reviewReady }),
  setPackageReady: (packageReady) => set({ packageReady }),
  setLatestContext: (latestContext) => set({ latestContext }),
  clearCompanionState: () => set({
    focusedTarget: null,
    openPanel: null,
    shadowCursor: null,
    reviewReady: null,
    packageReady: null,
    latestContext: null,
  }),
}));
