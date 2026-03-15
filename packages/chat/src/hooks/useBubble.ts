import { useChatBubble } from '../stores/bubble.js';

/** Convenience wrapper on the bubble store. */
export function useBubble() {
  return useChatBubble();
}
