import { useAgentActions } from '../stores/actions.js';
import type { ChatBubbleEvent } from '../types/events.js';
import type {
  CompanionContextSnapshot,
  CompanionReadinessState,
} from '../types/chat.js';
import type { AgentHostAdapter } from '../types/host.js';

type HostEvent =
  | Extract<ChatBubbleEvent, { type: 'agent_action_completed' }>
  | Extract<ChatBubbleEvent, { type: 'agent_action_failed' }>
  | Extract<ChatBubbleEvent, { type: 'agent_action_proposed' }>
  | Extract<ChatBubbleEvent, { type: 'app_context' }>
  | Extract<ChatBubbleEvent, { type: 'focus_target' }>
  | Extract<ChatBubbleEvent, { type: 'open_panel' }>
  | Extract<ChatBubbleEvent, { type: 'package_ready' }>
  | Extract<ChatBubbleEvent, { type: 'review_ready' }>
  | Extract<ChatBubbleEvent, { type: 'scroll_to_anchor' }>
  | Extract<ChatBubbleEvent, { type: 'shadow_cursor' }>
  | Extract<ChatBubbleEvent, { type: 'ui_highlight' }>
  | Extract<ChatBubbleEvent, { type: 'ui_navigate' }>;

export interface ApplyHostEventOptions {
  host?: AgentHostAdapter;
  onNavigate?: (path: string) => void;
  onRevalidate?: (keys: string[]) => void;
  onContextChange?: (context: CompanionContextSnapshot) => void;
  onReviewReadyChange?: (state: CompanionReadinessState | null) => void;
  onPackageReadyChange?: (state: CompanionReadinessState | null) => void;
}

function resolveTargetId(target: {
  target?: string;
  anchorId?: string;
  id?: string;
}): string | null {
  return target.target || target.anchorId || target.id || null;
}

export function applyHostEvent(
  event: HostEvent,
  options: ApplyHostEventOptions = {},
) {
  const { host, onContextChange, onNavigate, onPackageReadyChange, onRevalidate, onReviewReadyChange } = options;
  const actions = useAgentActions.getState();

  if (event.type === 'ui_highlight') {
    actions.addHighlight(event.data);
    host?.scrollToTarget?.(event.data.target);
    return;
  }

  if (event.type === 'ui_navigate') {
    onNavigate?.(event.data.path);
    host?.navigate?.(event.data.path);
    return;
  }

  if (event.type === 'agent_action_proposed') {
    actions.addPendingAction(event.data);
    return;
  }

  if (event.type === 'agent_action_completed') {
    actions.completeAction({
      proposalId: event.data.proposalId,
      actionType: event.data.actionType,
      description: '',
      params: {},
      status: 'completed',
    });
    if (event.data.revalidateKeys?.length) {
      onRevalidate?.(event.data.revalidateKeys);
    }
    return;
  }

  if (event.type === 'agent_action_failed') {
    actions.removePendingAction(event.data.proposalId);
    return;
  }

  if (event.type === 'focus_target') {
    actions.setFocusedTarget(event.data);
    const targetId = resolveTargetId(event.data);
    if (targetId) {
      host?.scrollToTarget?.(targetId);
    }
    return;
  }

  if (event.type === 'scroll_to_anchor') {
    host?.scrollToAnchor?.(event.data.anchorId, event.data.behavior);
    return;
  }

  if (event.type === 'shadow_cursor') {
    actions.setShadowCursor(event.data);
    return;
  }

  if (event.type === 'open_panel') {
    actions.setOpenPanel(event.data.panel);
    host?.openPanel?.(event.data.panel);
    if (event.data.target) {
      actions.setFocusedTarget(event.data.target);
      const targetId = resolveTargetId(event.data.target);
      if (targetId) {
        host?.scrollToTarget?.(targetId);
      }
    }
    return;
  }

  if (event.type === 'review_ready') {
    actions.setReviewReady(event.data);
    onReviewReadyChange?.(event.data);
    return;
  }

  if (event.type === 'package_ready') {
    actions.setPackageReady(event.data);
    onPackageReadyChange?.(event.data);
    return;
  }

  if (event.type === 'app_context') {
    actions.setLatestContext(event.data);
    if (typeof event.data.openPanel === 'string' || event.data.openPanel === null) {
      actions.setOpenPanel(event.data.openPanel ?? null);
    }
    onContextChange?.(event.data);
  }
}
