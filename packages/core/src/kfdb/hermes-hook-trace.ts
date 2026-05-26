import { createHash, randomUUID } from 'node:crypto';

export interface HermesHookEventRecord {
  sequence: number;
  hookEventName: string;
  hermesSessionId: string;
  gatewaySessionId?: string;
  platform?: string;
  chatIdHash?: string;
  userIdHash?: string;
  cwd?: string;
  model?: string;
  provider?: string;
  receivedAt: number;
  messageRole?: 'user' | 'assistant' | 'command' | 'system' | 'tool';
  message?: string;
  response?: string;
  commandName?: string;
  rawCommand?: string;
  commandArgs?: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  iteration?: number;
  durationMs?: number;
  outcomeStatus?: string;
  error?: string;
  rawEventType?: string;
}

export interface HermesHookTrace {
  walletAddress: string;
  agentId: string;
  sessionId: string;
  turnIndex: number;
  hermesSessionId: string;
  gatewaySessionId?: string;
  platform?: string;
  chatIdHash?: string;
  userIdHash?: string;
  cwd?: string;
  model?: string;
  provider?: string;
  startedAt: number;
  completedAt: number;
  events: HermesHookEventRecord[];
}

const KG_NAMESPACE = uuidV5('rickydata-hermes-hook-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
const EXECUTION_KG_NAMESPACE = uuidV5('rickydata-execution-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
const TRACE_SCHEMA_VERSION = 3;

function stableHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
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

function deterministicExecutionId(kind: string, parts: Array<string | number>): string {
  return uuidV5(`${kind}:${parts.map((p) => String(p)).join(':')}`, EXECUTION_KG_NAMESPACE);
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

function stableJson(input: unknown): string {
  if (input === null || input === undefined) return 'null';
  if (typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(stableJson).join(',')}]`;
  return `{${Object.entries(input as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
    .join(',')}}`;
}

function summarizePayload(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return { value: payload ?? null };
  if (typeof payload === 'string') return { contentLength: payload.length, contentHash: stableHash(payload) };
  const encoded = stableJson(payload);
  return { contentLength: encoded.length, contentHash: stableHash(encoded) };
}

function basename(input: string): string {
  const normalized = input.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function extension(input: string): string {
  const name = basename(input);
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function collectFilePaths(input: unknown, output = new Set<string>()): Set<string> {
  if (input === undefined || input === null) return output;
  if (typeof input === 'string') {
    for (const match of input.matchAll(/^\*{3} (?:Add|Update|Delete) File: (.+)$/gm)) output.add(match[1].trim());
    return output;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectFilePaths(item, output));
    return output;
  }
  if (typeof input !== 'object') return output;
  for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (typeof item === 'string' && /(^|_)(file|path|filepath|filename)$/.test(lowerKey) && item.length > 0 && item.length < 1_000) {
      output.add(item);
    } else {
      collectFilePaths(item, output);
    }
  }
  return output;
}

function extractCommand(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'script']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return null;
}

function summarizeCommand(command: string): Record<string, unknown> {
  const firstLine = command.split(/\r?\n/, 1)[0] ?? '';
  return { command_hash: stableHash(command), command_length: command.length, command_preview: firstLine.slice(0, 240) };
}

function eventData(event: HermesHookEventRecord): Record<string, unknown> {
  return {
    hookEventName: event.hookEventName,
    rawEventType: event.rawEventType,
    hermesSessionId: event.hermesSessionId,
    gatewaySessionId: event.gatewaySessionId,
    platform: event.platform,
    chatIdHash: event.chatIdHash,
    userIdHash: event.userIdHash,
    cwd: event.cwd,
    model: event.model,
    provider: event.provider,
    receivedAt: event.receivedAt,
    messageRole: event.messageRole,
    messageHash: event.message ? stableHash(event.message) : undefined,
    messageLength: event.message?.length,
    responseHash: event.response ? stableHash(event.response) : undefined,
    responseLength: event.response?.length,
    commandName: event.commandName,
    rawCommand: event.rawCommand,
    commandArgs: event.commandArgs === undefined ? undefined : summarizePayload(event.commandArgs),
    toolName: event.toolName,
    toolUseId: event.toolUseId,
    toolInput: event.toolInput === undefined ? undefined : summarizePayload(event.toolInput),
    toolResponse: event.toolResponse === undefined ? undefined : summarizePayload(event.toolResponse),
    iteration: event.iteration,
    durationMs: event.durationMs,
    outcomeStatus: event.outcomeStatus,
    error: event.error === undefined ? undefined : summarizePayload(event.error),
  };
}

function addWorkspaceOperations(operations: Array<Record<string, unknown>>, sourceNodeId: string, cwd: string | undefined): void {
  if (!cwd) return;
  const workspaceNodeId = deterministicExecutionId('CodeWorkspace', [cwd]);
  operations.push(
    { operation: 'create_node', id: workspaceNodeId, label: 'CodeWorkspace', mode: 'merge', properties: { path: value(cwd), path_hash: value(stableHash(cwd)), basename: value(basename(cwd)), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_edge', id: deterministicId('RAN_IN_WORKSPACE', [sourceNodeId, workspaceNodeId]), from: sourceNodeId, to: workspaceNodeId, edge_type: 'RAN_IN_WORKSPACE', properties: { source: value('hermes-hooks') } },
  );
}

function addCodeFileOperations(operations: Array<Record<string, unknown>>, sourceNodeId: string, paths: string[]): void {
  [...new Set(paths)].slice(0, 50).forEach((filePath) => {
    const fileNodeId = deterministicExecutionId('CodeFile', [filePath]);
    operations.push(
      { operation: 'create_node', id: fileNodeId, label: 'CodeFile', mode: 'merge', properties: { path: value(filePath), path_hash: value(stableHash(filePath)), basename: value(basename(filePath)), extension: value(extension(filePath)), schema_version: value(TRACE_SCHEMA_VERSION) } },
      { operation: 'create_edge', id: deterministicId('TOUCHED_FILE', [sourceNodeId, fileNodeId]), from: sourceNodeId, to: fileNodeId, edge_type: 'TOUCHED_FILE', properties: { source: value('hermes-hooks') } },
    );
  });
}

function addCommandOperation(operations: Array<Record<string, unknown>>, sourceNodeId: string, command: string | null): void {
  if (!command) return;
  const commandNodeId = deterministicExecutionId('CodeCommand', [stableHash(command)]);
  operations.push(
    { operation: 'create_node', id: commandNodeId, label: 'CodeCommand', mode: 'merge', properties: { ...Object.fromEntries(Object.entries(summarizeCommand(command)).map(([k, v]) => [k, value(v)])), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_edge', id: deterministicId('RAN_COMMAND', [sourceNodeId, commandNodeId]), from: sourceNodeId, to: commandNodeId, edge_type: 'RAN_COMMAND', properties: { source: value('hermes-hooks') } },
  );
}

export function buildHermesHookTraceOperations(trace: HermesHookTrace): Array<Record<string, unknown>> {
  const wallet = trace.walletAddress.toLowerCase();
  const provider = trace.provider ?? 'hermes';
  const model = trace.model ?? '';
  const sessionNodeId = deterministicId('HermesSession', [wallet, trace.agentId, trace.sessionId, trace.hermesSessionId]);
  const turnNodeId = deterministicId('HermesTurn', [wallet, trace.agentId, trace.sessionId, trace.turnIndex, trace.hermesSessionId]);
  const walletNodeId = deterministicExecutionId('WalletTenant', [wallet]);
  const agentNodeId = deterministicExecutionId('Agent', [trace.agentId]);
  const modelNodeId = model ? deterministicExecutionId('Model', [provider, model]) : null;
  const executionEngineNodeId = deterministicExecutionId('ExecutionEngine', ['hermes']);
  const operations: Array<Record<string, unknown>> = [
    { operation: 'create_node', id: walletNodeId, label: 'WalletTenant', mode: 'merge', properties: { wallet_address: value(wallet), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_node', id: agentNodeId, label: 'Agent', mode: 'merge', properties: { agent_id: value(trace.agentId), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_node', id: sessionNodeId, label: 'HermesSession', mode: 'merge', properties: { agent_id: value(trace.agentId), session_id: value(trace.sessionId), hermes_session_id: value(trace.hermesSessionId), gateway_session_id: value(trace.gatewaySessionId ?? ''), platform: value(trace.platform ?? ''), chat_id_hash: value(trace.chatIdHash ?? ''), user_id_hash: value(trace.userIdHash ?? ''), wallet_address: value(wallet), source: value('hermes-hooks'), privacy_scope: value('private'), schema_version: value(TRACE_SCHEMA_VERSION), updated_at: value(trace.completedAt) } },
    { operation: 'create_node', id: turnNodeId, label: 'HermesTurn', mode: 'merge', properties: { agent_id: value(trace.agentId), session_id: value(trace.sessionId), hermes_session_id: value(trace.hermesSessionId), turn_index: value(trace.turnIndex), model: value(model), provider: value(provider), execution_engine: value('hermes'), cwd: value(trace.cwd ?? ''), platform: value(trace.platform ?? ''), started_at: value(trace.startedAt), completed_at: value(trace.completedAt), event_count: value(trace.events.length), privacy_scope: value('private'), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_edge', id: deterministicExecutionId('OWNS_EXECUTION_SESSION', [walletNodeId, sessionNodeId]), from: walletNodeId, to: sessionNodeId, edge_type: 'OWNS_EXECUTION_SESSION', properties: { source: value('hermes-hooks') } },
    { operation: 'create_edge', id: deterministicExecutionId('EXECUTES_AGENT', [sessionNodeId, agentNodeId]), from: sessionNodeId, to: agentNodeId, edge_type: 'EXECUTES_AGENT', properties: { agent_id: value(trace.agentId) } },
    { operation: 'create_edge', id: deterministicId('HAS_HERMES_TURN', [sessionNodeId, turnNodeId]), from: sessionNodeId, to: turnNodeId, edge_type: 'HAS_HERMES_TURN', properties: { turn_index: value(trace.turnIndex) } },
    { operation: 'create_node', id: executionEngineNodeId, label: 'ExecutionEngine', mode: 'merge', properties: { execution_engine: value('hermes'), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_edge', id: deterministicExecutionId('USES_EXECUTION_ENGINE', [turnNodeId, executionEngineNodeId]), from: turnNodeId, to: executionEngineNodeId, edge_type: 'USES_EXECUTION_ENGINE', properties: { execution_engine: value('hermes') } },
  ];

  if (modelNodeId) operations.push(
    { operation: 'create_node', id: modelNodeId, label: 'Model', mode: 'merge', properties: { provider: value(provider), model: value(model), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_edge', id: deterministicExecutionId('USES_MODEL', [turnNodeId, modelNodeId]), from: turnNodeId, to: modelNodeId, edge_type: 'USES_MODEL', properties: { provider: value(provider), model: value(model) } },
  );

  addWorkspaceOperations(operations, turnNodeId, trace.cwd);

  trace.events.forEach((event) => {
    const eventId = deterministicId('HermesHookEvent', [turnNodeId, event.sequence, event.hookEventName, event.toolUseId ?? '']);
    operations.push(
      { operation: 'create_node', id: eventId, label: 'HermesHookEvent', mode: 'merge', properties: { event_index: value(event.sequence), event_type: value(event.hookEventName), raw_event_type: value(event.rawEventType ?? ''), cwd: value(event.cwd ?? trace.cwd ?? ''), platform: value(event.platform ?? trace.platform ?? ''), tool_name: value(event.toolName ?? ''), tool_use_id: value(event.toolUseId ?? ''), data: value(eventData(event)), privacy_scope: value('private'), schema_version: value(TRACE_SCHEMA_VERSION) } },
      { operation: 'create_edge', id: deterministicId('EMITTED_HERMES_HOOK', [turnNodeId, eventId]), from: turnNodeId, to: eventId, edge_type: 'EMITTED_HERMES_HOOK', properties: { event_index: value(event.sequence) } },
    );
    addWorkspaceOperations(operations, eventId, event.cwd ?? trace.cwd);

    const toolNodeId = event.toolName ? deterministicId('HermesToolUse', [turnNodeId, event.toolUseId ?? event.sequence, event.toolName]) : null;
    if (toolNodeId) operations.push(
      { operation: 'create_node', id: toolNodeId, label: 'HermesToolUse', mode: 'merge', properties: { tool_name: value(event.toolName), tool_use_id: value(event.toolUseId ?? ''), hook_event_name: value(event.hookEventName), event_index: value(event.sequence), iteration: value(event.iteration ?? 0), tool_input: value(event.toolInput === undefined ? undefined : summarizePayload(event.toolInput)), tool_response: value(event.toolResponse === undefined ? undefined : summarizePayload(event.toolResponse)), command: value(extractCommand(event.toolInput) ? summarizeCommand(extractCommand(event.toolInput)!) : undefined), duration_ms: value(event.durationMs ?? null), schema_version: value(TRACE_SCHEMA_VERSION) } },
      { operation: 'create_edge', id: deterministicId('INVOKED_HERMES_TOOL', [turnNodeId, toolNodeId]), from: turnNodeId, to: toolNodeId, edge_type: 'INVOKED_HERMES_TOOL', properties: { tool_name: value(event.toolName) } },
    );

    const commandText = extractCommand(event.toolInput) ?? (event.commandName ? `${event.commandName} ${event.commandArgs ?? ''}`.trim() : null);
    const projectionSourceId = toolNodeId ?? eventId;
    addCodeFileOperations(operations, projectionSourceId, [...collectFilePaths(event.toolInput), ...collectFilePaths(event.toolResponse)]);
    addCommandOperation(operations, projectionSourceId, commandText);
  });

  return operations;
}

export function createHermesHookTraceFixture(walletAddress: string): HermesHookTrace {
  const now = Date.now();
  const sessionId = randomUUID();
  return {
    walletAddress,
    agentId: 'sdk-hermes-hook-canary',
    sessionId,
    turnIndex: 1,
    hermesSessionId: `hermes-${sessionId}`,
    platform: 'telegram',
    chatIdHash: stableHash('chat-1').slice(0, 16),
    userIdHash: stableHash('user-1').slice(0, 16),
    model: 'gpt-5.5',
    provider: 'openai-codex',
    cwd: '/workspace/repo',
    startedAt: now,
    completedAt: now + 3,
    events: [
      { sequence: 0, hookEventName: 'agent:start', hermesSessionId: `hermes-${sessionId}`, platform: 'telegram', receivedAt: now, messageRole: 'user', message: 'please edit src/index.ts', cwd: '/workspace/repo', model: 'gpt-5.5', provider: 'openai-codex' },
      { sequence: 1, hookEventName: 'agent:step', hermesSessionId: `hermes-${sessionId}`, platform: 'telegram', receivedAt: now + 1, toolName: 'patch', toolUseId: 'toolu_hermes', toolInput: { path: 'src/index.ts', old_string: 'a', new_string: 'b' }, toolResponse: { success: true }, iteration: 2, cwd: '/workspace/repo' },
      { sequence: 2, hookEventName: 'command:status', hermesSessionId: `hermes-${sessionId}`, platform: 'telegram', receivedAt: now + 2, commandName: 'status', rawCommand: 'status', messageRole: 'command', cwd: '/workspace/repo' },
      { sequence: 3, hookEventName: 'agent:end', hermesSessionId: `hermes-${sessionId}`, platform: 'telegram', receivedAt: now + 3, messageRole: 'assistant', response: 'Done.', outcomeStatus: 'success', cwd: '/workspace/repo' },
    ],
  };
}
