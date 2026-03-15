import type { ActionProposal, HighlightTarget } from './actions.js';

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
  | { type: 'ui_navigate'; data: { path: string } };
