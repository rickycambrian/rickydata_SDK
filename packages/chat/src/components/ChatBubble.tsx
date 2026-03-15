import { useChatBubble } from '../stores/bubble.js';
import { ChatBubbleButton } from './ChatBubbleButton.js';
import { ChatBubbleWindow } from './ChatBubbleWindow.js';
import { HighlightOverlay } from './HighlightOverlay.js';

/** Root chat bubble component. Renders button or window based on isOpen state. */
export function ChatBubble() {
  const { isOpen } = useChatBubble();

  return (
    <>
      {isOpen ? <ChatBubbleWindow /> : <ChatBubbleButton />}
      <HighlightOverlay />
    </>
  );
}
