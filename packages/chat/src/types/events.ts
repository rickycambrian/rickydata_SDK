import type { ActionProposal, HighlightTarget } from './actions.js';
import type {
  CompanionContextSnapshot,
  CompanionCursorShadow,
  CompanionReadinessState,
  CompanionTarget,
} from './chat.js';

/** Discriminated union of events the chat bubble can emit. */
export type ChatBubbleEvent =
  | { type: 'text'; data: { text: string } }
  | { type: 'tool_call'; data: { id: string; name: string; displayName?: string; args: unknown } }
  | { type: 'tool_result'; data: { id?: string; name?: string; result?: string; content?: string; isError?: boolean } }
  | { type: 'done'; data: { cost?: string; toolCallCount?: number } }
  | { type: 'error'; data: { message: string } }
  | { type: 'agent_action_proposed'; data: ActionProposal }
  | { type: 'agent_action_completed'; data: { proposalId: string; actionType: string; revalidateKeys?: string[] } }
  | { type: 'agent_action_failed'; data: { proposalId: string } }
  | { type: 'ui_highlight'; data: HighlightTarget }
  | { type: 'ui_navigate'; data: { path: string } }
  | { type: 'focus_target'; data: CompanionTarget }
  | { type: 'scroll_to_anchor'; data: { anchorId: string; behavior?: ScrollBehavior } }
  | { type: 'shadow_cursor'; data: CompanionCursorShadow }
  | { type: 'open_panel'; data: { panel: string; target?: CompanionTarget } }
  | { type: 'review_ready'; data: CompanionReadinessState }
  | { type: 'package_ready'; data: CompanionReadinessState }
  | { type: 'app_context'; data: CompanionContextSnapshot };
