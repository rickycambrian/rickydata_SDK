import { create } from 'zustand';
import type { ActionProposal, HighlightTarget } from '../types/actions.js';

interface AgentActionsState {
  activeHighlights: Map<string, HighlightTarget>;
  pendingActions: Map<string, ActionProposal>;
  completedActions: ActionProposal[];

  addHighlight: (highlight: HighlightTarget) => void;
  removeHighlight: (target: string) => void;
  clearHighlights: () => void;

  addPendingAction: (action: ActionProposal) => void;
  removePendingAction: (proposalId: string) => void;
  completeAction: (action: ActionProposal) => void;
  clearCompleted: () => void;
}

export const useAgentActions = create<AgentActionsState>((set) => ({
  activeHighlights: new Map(),
  pendingActions: new Map(),
  completedActions: [],

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
}));
