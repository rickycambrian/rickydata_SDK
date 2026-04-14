import type { ActionProposal, HighlightTarget } from '../types/actions.js';
import type { ChatBubbleEvent } from '../types/events.js';
import type { AgentHostContextSnapshot } from '../types/host.js';
import type {
  CompanionContextSnapshot,
  CompanionCursorShadow,
  CompanionReadinessState,
  CompanionTarget,
  DocumentAnchor,
} from '../types/chat.js';

const HOST_FENCE_RE = /```rickydata_host\s*([\s\S]*?)```/gi;

interface HostDirectiveEnvelope {
  events?: unknown[];
  highlights?: unknown[];
  actions?: unknown[];
  navigate?: unknown;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeHighlight(value: unknown): HighlightTarget | null {
  const record = toRecord(value);
  if (!record) return null;
  const target = toString(record.target);
  if (!target) return null;
  return {
    target,
    tooltip: toString(record.tooltip),
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : undefined,
    delayMs: typeof record.delayMs === 'number' ? record.delayMs : undefined,
  };
}

function normalizeAction(value: unknown, index: number): ActionProposal | null {
  const record = toRecord(value);
  if (!record) return null;
  const actionType = toString(record.actionType) ?? toString(record.action_type);
  const description = toString(record.description);
  if (!actionType || !description) return null;
  const proposalId =
    toString(record.proposalId)
    ?? toString(record.proposal_id)
    ?? `proposal-${Date.now()}-${index}`;
  const params = toRecord(record.params) ?? {};
  const status = record.status === 'completed' || record.status === 'rejected' || record.status === 'failed'
    ? record.status
    : 'pending';
  return {
    proposalId,
    actionType,
    description,
    params,
    status,
  };
}

function normalizeTarget(value: unknown): CompanionTarget | null {
  const record = toRecord(value);
  if (!record) return null;
  const id = toString(record.id);
  if (!id) return null;
  return {
    id,
    target: toString(record.target),
    anchorId: toString(record.anchorId) ?? toString(record.anchor_id),
    label: toString(record.label),
    panel: toString(record.panel),
    path: toString(record.path),
    tooltip: toString(record.tooltip),
    x: toNumber(record.x),
    y: toNumber(record.y),
    metadata: toRecord(record.metadata) ?? undefined,
  };
}

function normalizeShadowCursor(value: unknown): CompanionCursorShadow | null {
  const record = toRecord(value);
  if (!record) return null;
  const active = toBoolean(record.active);
  if (active == null) return null;
  const pointerRecord = toRecord(record.pointer);
  const status = toString(record.status);
  return {
    active,
    label: toString(record.label),
    status:
      status === 'idle'
      || status === 'thinking'
      || status === 'guiding'
      || status === 'ready'
      || status === 'listening'
      || status === 'processing'
      || status === 'responding'
      || status === 'pointing'
        ? status
        : undefined,
    tooltip: toString(record.tooltip),
    pointer: pointerRecord
      ? {
          viewportX: toNumber(pointerRecord.viewportX) ?? 0,
          viewportY: toNumber(pointerRecord.viewportY) ?? 0,
          documentX: toNumber(pointerRecord.documentX),
          documentY: toNumber(pointerRecord.documentY),
          insideApp: toBoolean(pointerRecord.insideApp),
          updatedAt: toString(pointerRecord.updatedAt) ?? new Date().toISOString(),
        }
      : null,
  };
}

function normalizeReadiness(value: unknown): CompanionReadinessState | null {
  const record = toRecord(value);
  if (!record) return null;
  const title = toString(record.title);
  if (!title) return null;
  return {
    title,
    summary: toString(record.summary),
    count: toNumber(record.count),
    target: normalizeTarget(record.target) ?? undefined,
    metadata: toRecord(record.metadata) ?? undefined,
  };
}

function normalizeContextSnapshot(value: unknown): CompanionContextSnapshot | null {
  const record = toRecord(value);
  if (!record) return null;
  const route = toString(record.route);
  if (!route) return null;
  const visibleAnchors: DocumentAnchor[] = Array.isArray(record.visibleAnchors)
    ? record.visibleAnchors
        .map((entry): DocumentAnchor | null => {
          const anchor = toRecord(entry);
          const id = toString(anchor?.id);
          const kind = toString(anchor?.kind);
          const label = toString(anchor?.label);
          if (!id || !kind || !label) return null;
          return {
            id,
            kind: kind as DocumentAnchor['kind'],
            label,
            target: toString(anchor?.target),
            sectionId: toString(anchor?.sectionId),
            page: toNumber(anchor?.page),
            textPreview: toString(anchor?.textPreview),
            metadata: toRecord(anchor?.metadata) ?? undefined,
          };
        })
        .filter((entry): entry is DocumentAnchor => entry !== null)
    : [];
  return {
    route,
    stage: toString(record.stage),
    view: toString(record.view),
    title: toString(record.title),
    entityId: toString(record.entityId),
    selection: toRecord(record.selection) ?? undefined,
    execution: toRecord(record.execution) ?? undefined,
    visibleTargets: Array.isArray(record.visibleTargets)
      ? record.visibleTargets
          .map((entry) => {
            const target = toRecord(entry);
            const id = toString(target?.id);
            const label = toString(target?.label);
            if (!id || !label) return null;
            return {
              id,
              label,
              description: toString(target?.description),
              role: toString(target?.role),
              visible: toBoolean(target?.visible),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [],
    readingMode:
      record.readingMode === 'pdf' || record.readingMode === 'markdown' || record.readingMode === 'split'
        ? record.readingMode
        : undefined,
    activePaperId: toString(record.activePaperId),
    activePaperTitle: toString(record.activePaperTitle),
    activeSectionIds: Array.isArray(record.activeSectionIds)
      ? record.activeSectionIds.map((entry) => toString(entry)).filter((entry): entry is string => Boolean(entry))
      : [],
    visibleAnchors,
    selectionText: toString(record.selectionText),
    hoverTarget: normalizeTarget(record.hoverTarget),
    pointer: (() => {
      const pointer = toRecord(record.pointer);
      if (!pointer) return null;
      const viewportX = toNumber(pointer.viewportX);
      const viewportY = toNumber(pointer.viewportY);
      const updatedAt = toString(pointer.updatedAt);
      if (viewportX == null || viewportY == null || !updatedAt) return null;
      return {
        viewportX,
        viewportY,
        documentX: toNumber(pointer.documentX),
        documentY: toNumber(pointer.documentY),
        insideApp: toBoolean(pointer.insideApp),
        updatedAt,
      };
    })(),
    scrollDepth: toNumber(record.scrollDepth),
    pendingReviewCount: toNumber(record.pendingReviewCount),
    reviewReady: toBoolean(record.reviewReady),
    packageReady: toBoolean(record.packageReady),
    openPanel: toString(record.openPanel) ?? null,
    threadId: toString(record.threadId) ?? null,
    sessionId: toString(record.sessionId) ?? null,
    metadata: toRecord(record.metadata) ?? undefined,
  };
}

function normalizeEvent(value: unknown, index: number): ChatBubbleEvent[] {
  const record = toRecord(value);
  if (!record) return [];
  const type = toString(record.type);
  if (!type) return [];

  if (type === 'ui_highlight') {
    const highlight = normalizeHighlight(record.data);
    return highlight ? [{ type, data: highlight }] : [];
  }

  if (type === 'ui_navigate') {
    const data = toRecord(record.data);
    const path = toString(data?.path);
    return path ? [{ type, data: { path } }] : [];
  }

  if (type === 'agent_action_proposed') {
    const proposal = normalizeAction(record.data, index);
    return proposal ? [{ type, data: proposal }] : [];
  }

  if (type === 'focus_target') {
    const target = normalizeTarget(record.data);
    return target ? [{ type, data: target }] : [];
  }

  if (type === 'scroll_to_anchor') {
    const data = toRecord(record.data);
    const anchorId = toString(data?.anchorId) ?? toString(data?.anchor_id);
    if (!anchorId) return [];
    const behavior = data?.behavior === 'smooth' || data?.behavior === 'auto' ? data.behavior : undefined;
    return [{ type, data: { anchorId, behavior } }];
  }

  if (type === 'shadow_cursor') {
    const shadow = normalizeShadowCursor(record.data);
    return shadow ? [{ type, data: shadow }] : [];
  }

  if (type === 'open_panel') {
    const data = toRecord(record.data);
    const panel = toString(data?.panel);
    if (!panel) return [];
    return [{ type, data: { panel, target: normalizeTarget(data?.target) ?? undefined } }];
  }

  if (type === 'review_ready') {
    const readiness = normalizeReadiness(record.data);
    return readiness ? [{ type, data: readiness }] : [];
  }

  if (type === 'package_ready') {
    const readiness = normalizeReadiness(record.data);
    return readiness ? [{ type, data: readiness }] : [];
  }

  if (type === 'app_context') {
    const snapshot = normalizeContextSnapshot(record.data);
    return snapshot ? [{ type, data: snapshot }] : [];
  }

  return [];
}

function normalizeEnvelope(value: unknown): ChatBubbleEvent[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => normalizeEvent(entry, index));
  }

  const record = toRecord(value) as HostDirectiveEnvelope | null;
  if (!record) return [];

  const events: ChatBubbleEvent[] = [];
  if (Array.isArray(record.events)) {
    events.push(...record.events.flatMap((entry, index) => normalizeEvent(entry, index)));
  }
  if (Array.isArray(record.highlights)) {
    events.push(
      ...record.highlights
        .map(normalizeHighlight)
        .filter((entry): entry is HighlightTarget => Boolean(entry))
        .map((entry) => ({ type: 'ui_highlight', data: entry } as const)),
    );
  }
  if (Array.isArray(record.actions)) {
    events.push(
      ...record.actions
        .map(normalizeAction)
        .filter((entry): entry is ActionProposal => Boolean(entry))
        .map((entry) => ({ type: 'agent_action_proposed', data: entry } as const)),
    );
  }
  const navigate = toRecord(record.navigate);
  const path = toString(navigate?.path);
  if (path) {
    events.push({ type: 'ui_navigate', data: { path } });
  }
  return events;
}

export interface ParsedHostDirectives {
  cleanText: string;
  events: ChatBubbleEvent[];
}

export function extractHostDirectives(text: string): ParsedHostDirectives {
  const events: ChatBubbleEvent[] = [];
  const cleanText = text.replace(HOST_FENCE_RE, (match, payload) => {
    try {
      events.push(...normalizeEnvelope(JSON.parse(payload) as unknown));
      return '';
    } catch {
      return match;
    }
  }).trim();

  return { cleanText, events };
}

export function buildHostContextMessage(
  userMessage: string,
  snapshot: AgentHostContextSnapshot,
): string {
  return [
    'You are operating inside a RickyData host application.',
    'Use the host context below to ground UI guidance and notebook suggestions.',
    'If you want the app to highlight UI or propose a confirmed action, append one fenced ```rickydata_host block with JSON.',
    'Use highlight target ids exactly as provided. Keep normal user-facing prose outside the block.',
    '',
    '<host_context>',
    JSON.stringify(snapshot, null, 2),
    '</host_context>',
    '',
    '<user_message>',
    userMessage,
    '</user_message>',
  ].join('\n');
}
