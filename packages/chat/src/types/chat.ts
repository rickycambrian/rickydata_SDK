/** Tool call + optional result within a chat message. */
export interface ToolExecution {
  id: string;
  name: string;
  displayName: string;
  args: unknown;
  result?: {
    content: string;
    isError: boolean;
  };
}

/** A message in the chat bubble UI. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source?: 'text' | 'voice' | 'system';
  created_at?: string;
  toolExecutions?: ToolExecution[];
  costUSD?: string;
}

/**
 * Generic chat context — apps define their own context types
 * by extending this shape.
 */
export interface ChatContext {
  type: string;
  refId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export type DocumentAnchorKind =
  | 'section'
  | 'quote'
  | 'claim_source'
  | 'citation'
  | 'review_card'
  | 'panel';

export interface DocumentAnchor {
  id: string;
  kind: DocumentAnchorKind;
  label: string;
  target?: string;
  sectionId?: string;
  page?: number;
  textPreview?: string;
  metadata?: Record<string, unknown>;
}

export interface CompanionTarget {
  id: string;
  target?: string;
  anchorId?: string;
  label?: string;
  panel?: string;
  path?: string;
  tooltip?: string;
  x?: number;
  y?: number;
  metadata?: Record<string, unknown>;
}

export interface CompanionPointerState {
  viewportX: number;
  viewportY: number;
  documentX?: number;
  documentY?: number;
  insideApp?: boolean;
  updatedAt: string;
}

export interface CompanionReadinessState {
  title: string;
  summary?: string;
  count?: number;
  target?: CompanionTarget;
  metadata?: Record<string, unknown>;
}

export interface CompanionContextSnapshot {
  route: string;
  stage?: string;
  view?: string;
  title?: string;
  entityId?: string;
  selection?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  visibleTargets?: Array<{
    id: string;
    label: string;
    description?: string;
    role?: string;
    visible?: boolean;
  }>;
  readingMode?: 'pdf' | 'markdown' | 'split';
  activePaperId?: string;
  activePaperTitle?: string;
  activeSectionIds?: string[];
  visibleAnchors: DocumentAnchor[];
  selectionText?: string;
  hoverTarget?: CompanionTarget | null;
  pointer?: CompanionPointerState | null;
  scrollDepth?: number;
  pendingReviewCount?: number;
  reviewReady?: boolean;
  packageReady?: boolean;
  openPanel?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
}

export type CompanionCursorStatus =
  | 'idle'
  | 'thinking'
  | 'guiding'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'responding'
  | 'pointing';

export interface CompanionCursorShadow {
  active: boolean;
  label?: string;
  status?: CompanionCursorStatus;
  pointer?: CompanionPointerState | null;
  tooltip?: string;
}

/** External engine interface — apps provide their own chat state machine. */
export interface ChatEngine {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  streaming: boolean;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  sendMessage: () => Promise<void>;
  isContextual: boolean;
  // Optional features
  sessionId?: string | null;
  streamingPhase?: 'idle' | 'tools' | 'streaming';
  activeTools?: string[];
  abort?: () => void;
  /** Live trace events for execution visibility (from @rickydata/trace). */
  traceEvents?: unknown[];
}
