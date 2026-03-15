import { create } from 'zustand';

export type ChatBubbleMode = 'chat' | 'voice' | 'threads';

export interface ChatBubbleState {
  isOpen: boolean;
  isMinimized: boolean;
  activeThreadId: string | null;
  mode: ChatBubbleMode;
  unreadCount: number;

  open: () => void;
  close: () => void;
  minimize: () => void;
  restore: () => void;
  setMode: (mode: ChatBubbleMode) => void;
  setActiveThreadId: (id: string | null) => void;
  incrementUnread: () => void;
  clearUnread: () => void;
}

export const useChatBubble = create<ChatBubbleState>((set) => ({
  isOpen: false,
  isMinimized: false,
  activeThreadId: null,
  mode: 'chat',
  unreadCount: 0,

  open: () => set({ isOpen: true, isMinimized: false }),
  close: () => set({ isOpen: false, isMinimized: false }),
  minimize: () => set({ isMinimized: true }),
  restore: () => set({ isMinimized: false }),
  setMode: (mode) => set({ mode }),
  setActiveThreadId: (id) => set({ activeThreadId: id }),
  incrementUnread: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
  clearUnread: () => set({ unreadCount: 0 }),
}));
