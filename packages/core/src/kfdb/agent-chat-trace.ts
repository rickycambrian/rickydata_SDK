import { createHash, randomUUID } from 'node:crypto';

export interface AgentChatTraceEvent {
  type: string;
  data?: unknown;
}

export interface AgentChatTurnTrace {
  walletAddress: string;
  agentId: string;
  sessionId: string;
  turnIndex: number;
  userMessage: string;
  assistantText: string;
  model?: string;
  provider?: string;
  executionEngine?: string;
  startedAt: number;
  completedAt: number;
  toolCallCount: number;
  events: AgentChatTraceEvent[];
}

const KG_NAMESPACE = uuidV5('rickydata-agent-chat-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

function stableHash(input: string): string {
  return sha256(input).toString('hex');
}

function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error('Invalid UUID namespace');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name)])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicId(kind: string, parts: Array<string | number>): string {
  return uuidV5(`${kind}:${parts.map((p) => String(p)).join(':')}`, KG_NAMESPACE);
}

function value(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) return { Null: null };
  if (typeof input === 'boolean') return { Boolean: input };
  if (typeof input === 'number') return Number.isInteger(input) ? { Integer: input } : { Float: input };
  if (Array.isArray(input)) return { Array: input.map(value) };
  if (typeof input === 'object') {
    return { Object: Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, value(v)])) };
  }
  return { String: String(input) };
}

function summarizeEventData(event: AgentChatTraceEvent): Record<string, unknown> {
  if (typeof event.data === 'string') {
    return { contentLength: event.data.length, contentHash: stableHash(event.data) };
  }
  if (!event.data || typeof event.data !== 'object') return { value: event.data ?? null };
  const data = event.data as Record<string, unknown>;
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    id: typeof data.id === 'string' ? data.id : undefined,
    isError: typeof data.isError === 'boolean' ? data.isError : undefined,
    code: typeof data.code === 'string' ? data.code : undefined,
    model: typeof data.model === 'string' ? data.model : undefined,
    toolCallCount: typeof data.toolCallCount === 'number' ? data.toolCallCount : undefined,
  };
}

export function buildAgentChatTraceOperations(trace: AgentChatTurnTrace): Array<Record<string, unknown>> {
  const wallet = trace.walletAddress.toLowerCase();
  const sessionNodeId = deterministicId('AgentChatSession', [wallet, trace.agentId, trace.sessionId]);
  const turnNodeId = deterministicId('AgentChatTurn', [wallet, trace.agentId, trace.sessionId, trace.turnIndex]);
  const userMessageId = deterministicId('AgentChatMessage', [turnNodeId, 'user']);
  const assistantMessageId = deterministicId('AgentChatMessage', [turnNodeId, 'assistant']);
  const operations: Array<Record<string, unknown>> = [
    {
      operation: 'create_node',
      id: sessionNodeId,
      label: 'AgentChatSession',
      mode: 'merge',
      properties: {
        agent_id: value(trace.agentId),
        session_id: value(trace.sessionId),
        wallet_address: value(wallet),
        source: value('rickydata-sdk'),
        schema_version: value(1),
        updated_at: value(trace.completedAt),
      },
    },
    {
      operation: 'create_node',
      id: turnNodeId,
      label: 'AgentChatTurn',
      mode: 'merge',
      properties: {
        agent_id: value(trace.agentId),
        session_id: value(trace.sessionId),
        turn_index: value(trace.turnIndex),
        user_message_hash: value(stableHash(trace.userMessage)),
        assistant_text_hash: value(stableHash(trace.assistantText)),
        model: value(trace.model ?? ''),
        provider: value(trace.provider ?? ''),
        execution_engine: value(trace.executionEngine ?? ''),
        started_at: value(trace.startedAt),
        completed_at: value(trace.completedAt),
        tool_call_count: value(trace.toolCallCount),
        event_count: value(trace.events.length),
        schema_version: value(1),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicId('HAS_TURN', [sessionNodeId, turnNodeId]),
      from: sessionNodeId,
      to: turnNodeId,
      edge_type: 'HAS_TURN',
      properties: { turn_index: value(trace.turnIndex) },
    },
    {
      operation: 'create_node',
      id: userMessageId,
      label: 'AgentChatMessage',
      mode: 'merge',
      properties: { role: value('user'), content: value(trace.userMessage), content_hash: value(stableHash(trace.userMessage)), timestamp: value(trace.startedAt), schema_version: value(1) },
    },
    {
      operation: 'create_node',
      id: assistantMessageId,
      label: 'AgentChatMessage',
      mode: 'merge',
      properties: { role: value('assistant'), content: value(trace.assistantText), content_hash: value(stableHash(trace.assistantText)), timestamp: value(trace.completedAt), schema_version: value(1) },
    },
    {
      operation: 'create_edge',
      id: deterministicId('HAS_MESSAGE', [turnNodeId, userMessageId]),
      from: turnNodeId,
      to: userMessageId,
      edge_type: 'HAS_MESSAGE',
      properties: { role: value('user') },
    },
    {
      operation: 'create_edge',
      id: deterministicId('HAS_MESSAGE', [turnNodeId, assistantMessageId]),
      from: turnNodeId,
      to: assistantMessageId,
      edge_type: 'HAS_MESSAGE',
      properties: { role: value('assistant') },
    },
  ];

  trace.events.forEach((event, index) => {
    const eventId = deterministicId('AgentChatEvent', [turnNodeId, index, event.type]);
    operations.push(
      {
        operation: 'create_node',
        id: eventId,
        label: 'AgentChatEvent',
        mode: 'merge',
        properties: {
          event_index: value(index),
          event_type: value(event.type),
          data: value(summarizeEventData(event)),
          schema_version: value(1),
        },
      },
      {
        operation: 'create_edge',
        id: deterministicId('EMITTED_EVENT', [turnNodeId, eventId]),
        from: turnNodeId,
        to: eventId,
        edge_type: 'EMITTED_EVENT',
        properties: { event_index: value(index) },
      },
    );
  });

  return operations;
}

export function createAgentChatTraceFixture(walletAddress: string): AgentChatTurnTrace {
  const now = Date.now();
  return {
    walletAddress,
    agentId: 'sdk-kg-canary',
    sessionId: randomUUID(),
    turnIndex: 1,
    userMessage: `SDK private KG canary ${now}`,
    assistantText: 'Canary response persisted to the private tenant graph.',
    model: 'canary',
    provider: 'sdk',
    executionEngine: 'sdk',
    startedAt: now,
    completedAt: now + 1,
    toolCallCount: 0,
    events: [{ type: 'done', data: { model: 'canary', toolCallCount: 0 } }],
  };
}
