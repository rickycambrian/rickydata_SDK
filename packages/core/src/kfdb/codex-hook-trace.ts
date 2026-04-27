import { createHash, randomUUID } from 'node:crypto';

export interface CodexHookEventRecord {
  sequence: number;
  hookEventName: string;
  codexSessionId: string;
  turnId?: string;
  model?: string;
  cwd?: string;
  receivedAt: number;
  prompt?: string;
  lastAssistantMessage?: string | null;
  stopHookActive?: boolean;
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
}

export interface CodexHookTrace {
  walletAddress: string;
  agentId: string;
  sessionId: string;
  turnIndex: number;
  codexSessionId: string;
  turnId: string;
  model?: string;
  cwd?: string;
  startedAt: number;
  completedAt: number;
  events: CodexHookEventRecord[];
}

const KG_NAMESPACE = uuidV5('rickydata-codex-hook-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
const EXECUTION_KG_NAMESPACE = uuidV5('rickydata-execution-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
const TRACE_SCHEMA_VERSION = 3;

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
  const entries = Object.entries(input as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
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
    for (const match of input.matchAll(/^\*{3} (?:Add|Update|Delete) File: (.+)$/gm)) {
      output.add(match[1].trim());
    }
    return output;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectFilePaths(item, output));
    return output;
  }
  if (typeof input !== 'object') return output;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      typeof value === 'string'
      && /(^|_)(file|path|filepath|filename)$/.test(lowerKey)
      && value.length > 0
      && value.length < 1_000
    ) {
      output.add(value);
    } else {
      collectFilePaths(value, output);
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
  return {
    command_hash: stableHash(command),
    command_length: command.length,
    command_preview: firstLine.slice(0, 240),
  };
}

function addWorkspaceOperations(
  operations: Array<Record<string, unknown>>,
  sourceNodeId: string,
  cwd: string | undefined,
): void {
  if (!cwd) return;
  const workspaceNodeId = deterministicExecutionId('CodeWorkspace', [cwd]);
  operations.push(
    {
      operation: 'create_node',
      id: workspaceNodeId,
      label: 'CodeWorkspace',
      mode: 'merge',
      properties: {
        path: value(cwd),
        path_hash: value(stableHash(cwd)),
        basename: value(basename(cwd)),
        source: value('codex-hooks'),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicId('RAN_IN_WORKSPACE', [sourceNodeId, workspaceNodeId]),
      from: sourceNodeId,
      to: workspaceNodeId,
      edge_type: 'RAN_IN_WORKSPACE',
      properties: { source: value('codex-hooks') },
    },
  );
}

function addCodeFileOperations(
  operations: Array<Record<string, unknown>>,
  sourceNodeId: string,
  paths: string[],
): void {
  [...new Set(paths)].slice(0, 50).forEach((filePath) => {
    const fileNodeId = deterministicExecutionId('CodeFile', [filePath]);
    operations.push(
      {
        operation: 'create_node',
        id: fileNodeId,
        label: 'CodeFile',
        mode: 'merge',
        properties: {
          path: value(filePath),
          path_hash: value(stableHash(filePath)),
          basename: value(basename(filePath)),
          extension: value(extension(filePath)),
          source: value('codex-hooks'),
          schema_version: value(TRACE_SCHEMA_VERSION),
        },
      },
      {
        operation: 'create_edge',
        id: deterministicId('TOUCHED_FILE', [sourceNodeId, fileNodeId]),
        from: sourceNodeId,
        to: fileNodeId,
        edge_type: 'TOUCHED_FILE',
        properties: { source: value('codex-hooks') },
      },
    );
  });
}

function addCommandOperation(
  operations: Array<Record<string, unknown>>,
  sourceNodeId: string,
  command: string | null,
): void {
  if (!command) return;
  const commandNodeId = deterministicExecutionId('CodeCommand', [stableHash(command)]);
  operations.push(
    {
      operation: 'create_node',
      id: commandNodeId,
      label: 'CodeCommand',
      mode: 'merge',
      properties: {
        ...Object.fromEntries(Object.entries(summarizeCommand(command)).map(([k, v]) => [k, value(v)])),
        source: value('codex-hooks'),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicId('RAN_COMMAND', [sourceNodeId, commandNodeId]),
      from: sourceNodeId,
      to: commandNodeId,
      edge_type: 'RAN_COMMAND',
      properties: { source: value('codex-hooks') },
    },
  );
}

function eventData(event: CodexHookEventRecord): Record<string, unknown> {
  return {
    hookEventName: event.hookEventName,
    codexSessionId: event.codexSessionId,
    turnId: event.turnId,
    model: event.model,
    cwd: event.cwd,
    receivedAt: event.receivedAt,
    promptHash: event.prompt ? stableHash(event.prompt) : undefined,
    promptLength: event.prompt?.length,
    lastAssistantMessageHash: event.lastAssistantMessage ? stableHash(event.lastAssistantMessage) : undefined,
    lastAssistantMessageLength: event.lastAssistantMessage?.length,
    stopHookActive: event.stopHookActive,
    toolName: event.toolName,
    toolUseId: event.toolUseId,
    toolInput: event.toolInput === undefined ? undefined : summarizePayload(event.toolInput),
    toolResponse: event.toolResponse === undefined ? undefined : summarizePayload(event.toolResponse),
  };
}

export function buildCodexHookTraceOperations(trace: CodexHookTrace): Array<Record<string, unknown>> {
  const wallet = trace.walletAddress.toLowerCase();
  const sessionNodeId = deterministicId('CodexSession', [wallet, trace.agentId, trace.sessionId, trace.codexSessionId]);
  const turnNodeId = deterministicId('CodexTurn', [wallet, trace.agentId, trace.sessionId, trace.turnIndex, trace.turnId]);
  const walletNodeId = deterministicExecutionId('WalletTenant', [wallet]);
  const agentNodeId = deterministicExecutionId('Agent', [trace.agentId]);
  const model = trace.model ?? '';
  const modelNodeId = model ? deterministicExecutionId('Model', ['openai', model]) : null;
  const executionEngineNodeId = deterministicExecutionId('ExecutionEngine', ['codex']);
  const operations: Array<Record<string, unknown>> = [
    {
      operation: 'create_node',
      id: walletNodeId,
      label: 'WalletTenant',
      mode: 'merge',
      properties: {
        wallet_address: value(wallet),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_node',
      id: agentNodeId,
      label: 'Agent',
      mode: 'merge',
      properties: {
        agent_id: value(trace.agentId),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_node',
      id: sessionNodeId,
      label: 'CodexSession',
      mode: 'merge',
      properties: {
        agent_id: value(trace.agentId),
        session_id: value(trace.sessionId),
        codex_session_id: value(trace.codexSessionId),
        wallet_address: value(wallet),
        source: value('codex-hooks'),
        schema_version: value(TRACE_SCHEMA_VERSION),
        updated_at: value(trace.completedAt),
      },
    },
    {
      operation: 'create_node',
      id: turnNodeId,
      label: 'CodexTurn',
      mode: 'merge',
      properties: {
        agent_id: value(trace.agentId),
        session_id: value(trace.sessionId),
        codex_session_id: value(trace.codexSessionId),
        turn_id: value(trace.turnId),
        turn_index: value(trace.turnIndex),
        model: value(model),
        provider: value('openai'),
        execution_engine: value('codex'),
        cwd: value(trace.cwd ?? ''),
        started_at: value(trace.startedAt),
        completed_at: value(trace.completedAt),
        event_count: value(trace.events.length),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicExecutionId('OWNS_EXECUTION_SESSION', [walletNodeId, sessionNodeId]),
      from: walletNodeId,
      to: sessionNodeId,
      edge_type: 'OWNS_EXECUTION_SESSION',
      properties: { source: value('codex-hooks') },
    },
    {
      operation: 'create_edge',
      id: deterministicExecutionId('EXECUTES_AGENT', [sessionNodeId, agentNodeId]),
      from: sessionNodeId,
      to: agentNodeId,
      edge_type: 'EXECUTES_AGENT',
      properties: { agent_id: value(trace.agentId) },
    },
    {
      operation: 'create_edge',
      id: deterministicId('HAS_CODEX_TURN', [sessionNodeId, turnNodeId]),
      from: sessionNodeId,
      to: turnNodeId,
      edge_type: 'HAS_CODEX_TURN',
      properties: { turn_index: value(trace.turnIndex) },
    },
  ];

  if (modelNodeId) {
    operations.push(
      {
        operation: 'create_node',
        id: modelNodeId,
        label: 'Model',
        mode: 'merge',
        properties: {
          provider: value('openai'),
          model: value(model),
          schema_version: value(TRACE_SCHEMA_VERSION),
        },
      },
      {
        operation: 'create_edge',
        id: deterministicExecutionId('USES_MODEL', [turnNodeId, modelNodeId]),
        from: turnNodeId,
        to: modelNodeId,
        edge_type: 'USES_MODEL',
        properties: { provider: value('openai'), model: value(model) },
      },
    );
  }

  operations.push(
    {
      operation: 'create_node',
      id: executionEngineNodeId,
      label: 'ExecutionEngine',
      mode: 'merge',
      properties: {
        execution_engine: value('codex'),
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicExecutionId('USES_EXECUTION_ENGINE', [turnNodeId, executionEngineNodeId]),
      from: turnNodeId,
      to: executionEngineNodeId,
      edge_type: 'USES_EXECUTION_ENGINE',
      properties: { execution_engine: value('codex') },
    },
  );
  addWorkspaceOperations(operations, turnNodeId, trace.cwd);

  trace.events.forEach((event) => {
    const eventId = deterministicId('CodexHookEvent', [
      turnNodeId,
      event.sequence,
      event.hookEventName,
      event.toolUseId ?? '',
    ]);
    operations.push(
      {
        operation: 'create_node',
        id: eventId,
        label: 'CodexHookEvent',
        mode: 'merge',
        properties: {
          event_index: value(event.sequence),
          event_type: value(event.hookEventName),
          data: value(eventData(event)),
          cwd: value(event.cwd ?? trace.cwd ?? ''),
          tool_name: value(event.toolName ?? ''),
          tool_use_id: value(event.toolUseId ?? ''),
          schema_version: value(TRACE_SCHEMA_VERSION),
        },
      },
      {
        operation: 'create_edge',
        id: deterministicId('EMITTED_CODEX_HOOK', [turnNodeId, eventId]),
        from: turnNodeId,
        to: eventId,
        edge_type: 'EMITTED_CODEX_HOOK',
        properties: { event_index: value(event.sequence) },
      },
    );
    addWorkspaceOperations(operations, eventId, event.cwd ?? trace.cwd);

    if (event.toolName) {
      const toolNodeId = deterministicId('CodexToolUse', [turnNodeId, event.toolUseId ?? event.sequence, event.toolName]);
      operations.push(
        {
          operation: 'create_node',
          id: toolNodeId,
          label: 'CodexToolUse',
          mode: 'merge',
          properties: {
            tool_name: value(event.toolName),
            tool_use_id: value(event.toolUseId ?? ''),
            hook_event_name: value(event.hookEventName),
            event_index: value(event.sequence),
            tool_input: value(event.toolInput === undefined ? undefined : summarizePayload(event.toolInput)),
            tool_response: value(event.toolResponse === undefined ? undefined : summarizePayload(event.toolResponse)),
            command: value(extractCommand(event.toolInput) ? summarizeCommand(extractCommand(event.toolInput)!) : undefined),
            schema_version: value(TRACE_SCHEMA_VERSION),
          },
        },
        {
          operation: 'create_edge',
          id: deterministicId('INVOKED_CODEX_TOOL', [turnNodeId, toolNodeId]),
          from: turnNodeId,
          to: toolNodeId,
          edge_type: 'INVOKED_CODEX_TOOL',
          properties: { tool_name: value(event.toolName) },
        },
      );
      addCodeFileOperations(
        operations,
        toolNodeId,
        [...collectFilePaths(event.toolInput), ...collectFilePaths(event.toolResponse)],
      );
      addCommandOperation(operations, toolNodeId, extractCommand(event.toolInput));
    } else {
      addCodeFileOperations(
        operations,
        eventId,
        [...collectFilePaths(event.toolInput), ...collectFilePaths(event.toolResponse)],
      );
      addCommandOperation(operations, eventId, extractCommand(event.toolInput));
    }
  });

  return operations;
}

export function createCodexHookTraceFixture(walletAddress: string): CodexHookTrace {
  const now = Date.now();
  const sessionId = randomUUID();
  return {
    walletAddress,
    agentId: 'sdk-codex-hook-canary',
    sessionId,
    turnIndex: 1,
    codexSessionId: `codex-${sessionId}`,
    turnId: `turn-${sessionId}`,
    model: 'gpt-5.3-codex',
    cwd: '/workspace',
    startedAt: now,
    completedAt: now + 1,
    events: [
      {
        sequence: 0,
        hookEventName: 'UserPromptSubmit',
        codexSessionId: `codex-${sessionId}`,
        turnId: `turn-${sessionId}`,
        model: 'gpt-5.3-codex',
        cwd: '/workspace',
        receivedAt: now,
        prompt: 'SDK Codex hook canary',
      },
      {
        sequence: 1,
        hookEventName: 'Stop',
        codexSessionId: `codex-${sessionId}`,
        turnId: `turn-${sessionId}`,
        model: 'gpt-5.3-codex',
        cwd: '/workspace',
        receivedAt: now + 1,
        lastAssistantMessage: 'Codex hook canary response.',
      },
    ],
  };
}
