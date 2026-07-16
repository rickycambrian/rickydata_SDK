import { createHash, randomUUID } from 'node:crypto';
import {
  buildContentArtifactOperations,
  buildDecisionObservationOperations,
  buildContextDeliveryReceiptOperations,
  type ContentArtifactRef,
  type ImmutableContentArtifactWrite,
  type RepositorySnapshot,
  type ObservableContextDelivery,
} from './decision-pack-v1.js';
import {
  buildSessionArtifactManifestOperations,
  type SessionArtifactManifestEntry,
} from './session-artifact-manifest.js';
import type { WorkContractRef } from './work-provenance-v1.js';

export interface ClaudeCodeHookEventRecord {
  sequence: number;
  hookEventName: string;
  claudeSessionId: string;
  transcriptPath?: string;
  cwd?: string;
  model?: string;
  source?: string;
  receivedAt: number;
  prompt?: string;
  /** Observable final assistant text supplied by Claude Code's Stop hook. */
  lastAssistantMessage?: string | null;
  reason?: string;
  stopHookActive?: boolean;
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  permissionDecision?: string;
  permissionDecisionReason?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  decisionKind?: 'ask_user' | 'tool_permission';
  decisionQuestion?: string;
  decisionOptions?: string[];
  decisionAnswer?: string;
  decisionPolicyRef?: string;
  /** Complete observable hook envelope as received from the harness. */
  hookPayload?: unknown;
  contextDelivery?: ObservableContextDelivery;
  /** Repository state at this event, rather than a session-wide approximation. */
  repository?: RepositorySnapshot;
  workContract?: WorkContractRef;
  sourceIntentRef?: string;
}

export interface ClaudeCodeHookTrace {
  walletAddress: string;
  agentId: string;
  sessionId: string;
  turnIndex: number;
  claudeSessionId: string;
  model?: string;
  cwd?: string;
  startedAt: number;
  completedAt: number;
  events: ClaudeCodeHookEventRecord[];
  benchmarkRunId?: string;
  filesChanged?: number;
  parentSessionId?: string;
  initialPrompt?: string;
  repository?: RepositorySnapshot;
  baseRepository?: RepositorySnapshot;
  resultRepository?: RepositorySnapshot;
  workContract?: WorkContractRef;
  sourceIntentRef?: string;
}

export interface ClaudeCodeHookTraceWriteBundle {
  operations: Array<Record<string, unknown>>;
  contentArtifacts: ImmutableContentArtifactWrite[];
}

const KG_NAMESPACE = uuidV5('rickydata-claude-code-hook-knowledge-graph-v1', '6ba7b811-9dad-11d1-80b4-00c04fd430c8');
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
  for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      typeof item === 'string'
      && /(^|_)(file|path|filepath|filename)$/.test(lowerKey)
      && item.length > 0
      && item.length < 1_000
    ) {
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
  return {
    command_hash: stableHash(command),
    command_length: command.length,
    command_preview: firstLine.slice(0, 240),
  };
}

function eventData(event: ClaudeCodeHookEventRecord, contentArtifacts: Record<string, ContentArtifactRef>): Record<string, unknown> {
  return {
    hookEventName: event.hookEventName,
    claudeSessionId: event.claudeSessionId,
    transcriptPath: event.transcriptPath,
    cwd: event.cwd,
    model: event.model,
    source: event.source,
    receivedAt: event.receivedAt,
    promptHash: event.prompt ? stableHash(event.prompt) : undefined,
    promptLength: event.prompt?.length,
    reason: event.reason,
    stopHookActive: event.stopHookActive,
    toolName: event.toolName,
    toolUseId: event.toolUseId,
    toolInput: event.toolInput === undefined ? undefined : summarizePayload(event.toolInput),
    toolResponse: event.toolResponse === undefined ? undefined : summarizePayload(event.toolResponse),
    permissionDecision: event.permissionDecision,
    permissionDecisionReason: event.permissionDecisionReason,
    exitCode: event.exitCode,
    stdout: event.stdout === undefined ? undefined : summarizePayload(event.stdout),
    stderr: event.stderr === undefined ? undefined : summarizePayload(event.stderr),
    durationMs: event.durationMs,
    contentArtifacts,
    decisionKind: event.decisionKind,
    decisionQuestion: event.decisionQuestion,
    decisionOptions: event.decisionOptions,
    decisionAnswer: event.decisionAnswer,
    decisionPolicyRef: event.decisionPolicyRef,
    hookPayload: event.hookPayload === undefined ? undefined : summarizePayload(event.hookPayload),
    contextDelivery: event.contextDelivery === undefined ? undefined : {
      ...event.contextDelivery,
      renderedContent: summarizePayload(event.contextDelivery.renderedContent),
    },
    repository: event.repository,
    workContract: event.workContract,
    sourceIntentRef: event.sourceIntentRef,
  };
}

function addWorkspaceOperations(operations: Array<Record<string, unknown>>, sourceNodeId: string, cwd: string | undefined): void {
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
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicId('RAN_IN_WORKSPACE', [sourceNodeId, workspaceNodeId]),
      from: sourceNodeId,
      to: workspaceNodeId,
      edge_type: 'RAN_IN_WORKSPACE',
      properties: { source: value('claude-code-hooks') },
    },
  );
}

function addCodeFileOperations(operations: Array<Record<string, unknown>>, sourceNodeId: string, paths: string[]): void {
  [...new Set(paths)].forEach((filePath) => {
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
          schema_version: value(TRACE_SCHEMA_VERSION),
        },
      },
      {
        operation: 'create_edge',
        id: deterministicId('TOUCHED_FILE', [sourceNodeId, fileNodeId]),
        from: sourceNodeId,
        to: fileNodeId,
        edge_type: 'TOUCHED_FILE',
        properties: { source: value('claude-code-hooks') },
      },
    );
  });
}

function addCommandOperation(operations: Array<Record<string, unknown>>, sourceNodeId: string, command: string | null): void {
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
        schema_version: value(TRACE_SCHEMA_VERSION),
      },
    },
    {
      operation: 'create_edge',
      id: deterministicId('RAN_COMMAND', [sourceNodeId, commandNodeId]),
      from: sourceNodeId,
      to: commandNodeId,
      edge_type: 'RAN_COMMAND',
      properties: { source: value('claude-code-hooks') },
    },
  );
}

/**
 * Deterministic node ID for the `ClaudeCodeSession` node that
 * {@link buildClaudeCodeHookTraceOperations} emits for the same trace. Exported
 * so callers (e.g. rd-plugin flush) can pass it as `fromNodeId` to
 * `buildSessionLinkOperations` without re-deriving the recipe.
 */
export function claudeCodeSessionNodeId(
  trace: Pick<ClaudeCodeHookTrace, 'walletAddress' | 'agentId' | 'sessionId' | 'claudeSessionId'>,
): string {
  const wallet = trace.walletAddress.toLowerCase();
  return deterministicId('ClaudeCodeSession', [wallet, trace.agentId, trace.sessionId, trace.claudeSessionId]);
}

export function buildClaudeCodeHookTraceOperations(trace: ClaudeCodeHookTrace): Array<Record<string, unknown>> {
  return buildClaudeCodeHookTraceWriteBundle(trace).operations;
}

export function buildClaudeCodeHookTraceWriteBundle(trace: ClaudeCodeHookTrace): ClaudeCodeHookTraceWriteBundle {
  const wallet = trace.walletAddress.toLowerCase();
  const sessionNodeId = claudeCodeSessionNodeId(trace);
  const turnNodeId = deterministicId('ClaudeCodeTurn', [wallet, trace.agentId, trace.sessionId, trace.turnIndex, trace.claudeSessionId]);
  const walletNodeId = deterministicExecutionId('WalletTenant', [wallet]);
  const agentNodeId = deterministicExecutionId('Agent', [trace.agentId]);
  const model = trace.model ?? '';
  const modelNodeId = model ? deterministicExecutionId('Model', ['anthropic', model]) : null;
  const executionEngineNodeId = deterministicExecutionId('ExecutionEngine', ['claude-code']);
  const sessionProperties: Record<string, unknown> = { agent_id: value(trace.agentId), session_id: value(trace.sessionId), claude_session_id: value(trace.claudeSessionId), wallet_address: value(wallet), source: value('claude-code-hooks'), schema_version: value(TRACE_SCHEMA_VERSION), updated_at: value(trace.completedAt), repository: value(trace.repository), base_repository: value(trace.baseRepository), result_repository: value(trace.resultRepository), work_contract: value(trace.workContract), source_intent_ref: value(trace.sourceIntentRef) };
  if (trace.filesChanged !== undefined) sessionProperties.files_changed = value(trace.filesChanged);
  if (trace.parentSessionId !== undefined) sessionProperties.parent_session_id = value(trace.parentSessionId);
  if (trace.initialPrompt !== undefined) sessionProperties.initial_prompt = value(trace.initialPrompt);
  const operations: Array<Record<string, unknown>> = [
    { operation: 'create_node', id: walletNodeId, label: 'WalletTenant', mode: 'merge', properties: { wallet_address: value(wallet), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_node', id: agentNodeId, label: 'Agent', mode: 'merge', properties: { agent_id: value(trace.agentId), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_node', id: sessionNodeId, label: 'ClaudeCodeSession', mode: 'merge', properties: sessionProperties },
    { operation: 'create_node', id: turnNodeId, label: 'ClaudeCodeTurn', mode: 'merge', properties: { agent_id: value(trace.agentId), session_id: value(trace.sessionId), claude_session_id: value(trace.claudeSessionId), turn_index: value(trace.turnIndex), model: value(model), provider: value('anthropic'), execution_engine: value('claude-code'), cwd: value(trace.cwd ?? ''), started_at: value(trace.startedAt), completed_at: value(trace.completedAt), event_count: value(trace.events.length), schema_version: value(TRACE_SCHEMA_VERSION), repository: value(trace.repository), base_repository: value(trace.baseRepository), result_repository: value(trace.resultRepository), work_contract: value(trace.workContract), source_intent_ref: value(trace.sourceIntentRef) } },
    { operation: 'create_edge', id: deterministicExecutionId('OWNS_EXECUTION_SESSION', [walletNodeId, sessionNodeId]), from: walletNodeId, to: sessionNodeId, edge_type: 'OWNS_EXECUTION_SESSION', properties: { source: value('claude-code-hooks') } },
    { operation: 'create_edge', id: deterministicExecutionId('EXECUTES_AGENT', [sessionNodeId, agentNodeId]), from: sessionNodeId, to: agentNodeId, edge_type: 'EXECUTES_AGENT', properties: { agent_id: value(trace.agentId) } },
    { operation: 'create_edge', id: deterministicId('HAS_CLAUDE_CODE_TURN', [sessionNodeId, turnNodeId]), from: sessionNodeId, to: turnNodeId, edge_type: 'HAS_CLAUDE_CODE_TURN', properties: { turn_index: value(trace.turnIndex) } },
    { operation: 'create_node', id: executionEngineNodeId, label: 'ExecutionEngine', mode: 'merge', properties: { execution_engine: value('claude-code'), schema_version: value(TRACE_SCHEMA_VERSION) } },
    { operation: 'create_edge', id: deterministicExecutionId('USES_EXECUTION_ENGINE', [turnNodeId, executionEngineNodeId]), from: turnNodeId, to: executionEngineNodeId, edge_type: 'USES_EXECUTION_ENGINE', properties: { execution_engine: value('claude-code') } },
  ];
  const contentArtifacts: ImmutableContentArtifactWrite[] = [];
  const manifestEntries: SessionArtifactManifestEntry[] = [];

  if (trace.initialPrompt !== undefined) {
    const initialPromptArtifact = buildContentArtifactOperations({
      content: trace.initialPrompt,
      mediaType: 'text/plain; charset=utf-8',
      observableKind: 'initial-human-prompt',
      sourceRef: `claude-code:${trace.claudeSessionId}:initial-prompt`,
    });
    contentArtifacts.push(...initialPromptArtifact.artifacts);
    manifestEntries.push({
      sequence: -1,
      eventType: 'SessionInitialPrompt',
      receivedAt: trace.startedAt,
      role: 'initial-human-prompt',
      artifact: initialPromptArtifact.ref,
    });
    operations.push(...initialPromptArtifact.operations, {
      operation: 'create_edge',
      id: deterministicId('INCLUDES_ARTIFACT', [sessionNodeId, initialPromptArtifact.ref.artifactId]),
      from: sessionNodeId,
      to: initialPromptArtifact.ref.artifactId,
      edge_type: 'INCLUDES_ARTIFACT',
      properties: { role: value('initial-human-prompt'), content_hash: value(initialPromptArtifact.ref.contentHash) },
    });
    sessionProperties.initial_prompt_artifact = value(initialPromptArtifact.ref);
  }

  if (modelNodeId) {
    operations.push(
      { operation: 'create_node', id: modelNodeId, label: 'Model', mode: 'merge', properties: { provider: value('anthropic'), model: value(model), schema_version: value(TRACE_SCHEMA_VERSION) } },
      { operation: 'create_edge', id: deterministicExecutionId('USES_MODEL', [turnNodeId, modelNodeId]), from: turnNodeId, to: modelNodeId, edge_type: 'USES_MODEL', properties: { provider: value('anthropic'), model: value(model) } },
    );
  }

  addWorkspaceOperations(operations, turnNodeId, trace.cwd);

  trace.events.forEach((event) => {
    const eventId = deterministicId('ClaudeCodeHookEvent', [turnNodeId, event.sequence, event.hookEventName, event.toolUseId ?? '']);
    const artifactRefs: Record<string, ContentArtifactRef> = {};
    const observable: Array<{ role: string; content: string; mediaType: string }> = [];
    if (event.prompt !== undefined) observable.push({ role: 'human-prompt', content: event.prompt, mediaType: 'text/plain; charset=utf-8' });
    if (event.lastAssistantMessage !== undefined && event.lastAssistantMessage !== null) {
      observable.push({ role: 'assistant-message', content: event.lastAssistantMessage, mediaType: 'text/plain; charset=utf-8' });
    }
    if (event.toolInput !== undefined) observable.push({ role: 'tool-input', content: stableJson(event.toolInput), mediaType: 'application/json' });
    if (event.toolResponse !== undefined) observable.push({ role: 'tool-response', content: stableJson(event.toolResponse), mediaType: 'application/json' });
    if (event.stdout !== undefined) observable.push({ role: 'tool-stdout', content: event.stdout, mediaType: 'text/plain; charset=utf-8' });
    if (event.stderr !== undefined) observable.push({ role: 'tool-stderr', content: event.stderr, mediaType: 'text/plain; charset=utf-8' });
    if (event.decisionQuestion !== undefined) observable.push({ role: 'decision-question', content: event.decisionQuestion, mediaType: 'text/plain; charset=utf-8' });
    if (event.decisionOptions !== undefined) observable.push({ role: 'decision-options', content: stableJson(event.decisionOptions), mediaType: 'application/json' });
    if (event.decisionAnswer !== undefined) observable.push({ role: 'decision-answer', content: event.decisionAnswer, mediaType: 'text/plain; charset=utf-8' });
    if (event.hookPayload !== undefined) observable.push({ role: 'hook-envelope', content: stableJson(event.hookPayload), mediaType: 'application/json' });
    if (event.contextDelivery !== undefined) observable.push({ role: 'rendered-context', content: event.contextDelivery.renderedContent, mediaType: 'text/plain; charset=utf-8' });
    for (const item of observable) {
      const built = buildContentArtifactOperations({
        content: item.content,
        mediaType: item.mediaType,
        observableKind: item.role,
        sourceRef: `claude-code:${trace.claudeSessionId}:${trace.turnIndex}:${event.sequence}:${item.role}`,
      });
      artifactRefs[item.role] = built.ref;
      contentArtifacts.push(...built.artifacts);
      operations.push(...built.operations);
      manifestEntries.push({
        sequence: event.sequence,
        eventType: event.hookEventName,
        receivedAt: event.receivedAt,
        role: item.role,
        ...(event.toolName ? { toolName: event.toolName } : {}),
        ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
        artifact: built.ref,
      });
    }
    operations.push(
      { operation: 'create_node', id: eventId, label: 'ClaudeCodeHookEvent', mode: 'merge', properties: { event_index: value(event.sequence), event_type: value(event.hookEventName), cwd: value(event.cwd ?? trace.cwd ?? ''), tool_name: value(event.toolName ?? ''), tool_use_id: value(event.toolUseId ?? ''), data: value(eventData(event, artifactRefs)), schema_version: value(TRACE_SCHEMA_VERSION) } },
      { operation: 'create_edge', id: deterministicId('EMITTED_CLAUDE_CODE_HOOK', [turnNodeId, eventId]), from: turnNodeId, to: eventId, edge_type: 'EMITTED_CLAUDE_CODE_HOOK', properties: { event_index: value(event.sequence) } },
    );
    for (const [role, artifact] of Object.entries(artifactRefs)) {
      operations.push({ operation: 'create_edge', id: deterministicId('INCLUDES_ARTIFACT', [eventId, artifact.artifactId]), from: eventId, to: artifact.artifactId, edge_type: 'INCLUDES_ARTIFACT', properties: { role: value(role), content_hash: value(artifact.contentHash) } });
    }
    if (event.contextDelivery && artifactRefs['rendered-context']) {
      const receipt = buildContextDeliveryReceiptOperations({
        deliveryKey: event.contextDelivery.deliveryKey,
        session: { nodeId: sessionNodeId, label: 'ClaudeCodeSession' },
        packId: event.contextDelivery.packId,
        packHash: event.contextDelivery.packHash,
        renderedArtifact: artifactRefs['rendered-context'],
        interface: event.contextDelivery.interface,
        coverageStatus: event.contextDelivery.coverageStatus,
        omissions: event.contextDelivery.omissions,
        deliveredAt: event.contextDelivery.deliveredAt,
        policyHash: event.contextDelivery.policyHash,
        selectedManifestHash: event.contextDelivery.selectedManifestHash,
        corpusWatermark: event.contextDelivery.corpusWatermark,
      });
      operations.push(...receipt.operations);
    }
    addWorkspaceOperations(operations, eventId, event.cwd ?? trace.cwd);
    const toolNodeId = event.toolName ? deterministicId('ClaudeCodeToolUse', [turnNodeId, event.toolUseId ?? event.sequence, event.toolName]) : null;
    if (toolNodeId) {
      operations.push(
        { operation: 'create_node', id: toolNodeId, label: 'ClaudeCodeToolUse', mode: 'merge', properties: { tool_name: value(event.toolName), tool_use_id: value(event.toolUseId ?? ''), hook_event_name: value(event.hookEventName), event_index: value(event.sequence), tool_input: value(event.toolInput === undefined ? undefined : summarizePayload(event.toolInput)), tool_response: value(event.toolResponse === undefined ? undefined : summarizePayload(event.toolResponse)), command: value(extractCommand(event.toolInput) ? summarizeCommand(extractCommand(event.toolInput)!) : undefined), permission_decision: value(event.permissionDecision ?? ''), schema_version: value(TRACE_SCHEMA_VERSION) } },
        { operation: 'create_edge', id: deterministicId('INVOKED_CLAUDE_CODE_TOOL', [turnNodeId, toolNodeId]), from: turnNodeId, to: toolNodeId, edge_type: 'INVOKED_CLAUDE_CODE_TOOL', properties: { tool_name: value(event.toolName) } },
      );
    }
    const projectionSourceId = toolNodeId ?? eventId;
    addCodeFileOperations(operations, projectionSourceId, [...collectFilePaths(event.toolInput), ...collectFilePaths(event.toolResponse)]);
    addCommandOperation(operations, projectionSourceId, extractCommand(event.toolInput));

    const decisionKind = event.decisionKind ?? (event.permissionDecision !== undefined
      ? 'tool_permission'
      : event.toolName && /askuser|ask_user/i.test(event.toolName)
        ? 'ask_user'
        : null);
    if (decisionKind) {
      let questionArtifact = artifactRefs['decision-question'] ?? artifactRefs['tool-input'] ?? artifactRefs['human-prompt'];
      if (!questionArtifact) {
        const built = buildContentArtifactOperations({
          content: stableJson({ toolName: event.toolName, reason: event.reason }),
          mediaType: 'application/json',
          observableKind: 'decision-question',
          sourceRef: `claude-code:${trace.claudeSessionId}:${trace.turnIndex}:${event.sequence}:decision-question`,
        });
        questionArtifact = built.ref;
        contentArtifacts.push(...built.artifacts);
        operations.push(...built.operations);
      }
      const observation = buildDecisionObservationOperations({
        observationKey: `${decisionKind}:${event.toolUseId ?? event.sequence}`,
        session: { nodeId: sessionNodeId, label: 'ClaudeCodeSession' },
        kind: decisionKind,
        interface: 'claude-code',
        questionArtifact,
        optionsArtifact: artifactRefs['decision-options'] ?? artifactRefs['tool-input'],
        rationaleArtifact: artifactRefs['decision-answer'],
        optionsPresented: event.decisionOptions ?? [],
        selectedOption: event.decisionAnswer ?? event.permissionDecision ?? (event.toolResponse === undefined ? undefined : stableJson(event.toolResponse)),
        actor: 'human',
        policyRef: event.decisionPolicyRef ?? event.permissionDecisionReason,
        observedAt: new Date(event.receivedAt).toISOString(),
      });
      operations.push(...observation.operations);
    }
  });

  const manifest = buildSessionArtifactManifestOperations({
    engine: 'claude-code',
    runtime: { agentId: trace.agentId, ...(trace.model ? { model: trace.model } : {}), ...(trace.cwd ? { cwd: trace.cwd } : {}) },
    session: { nodeId: sessionNodeId, label: 'ClaudeCodeSession', externalSessionId: trace.claudeSessionId },
    turn: {
      nodeId: turnNodeId,
      label: 'ClaudeCodeTurn',
      index: trace.turnIndex,
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
    },
    repository: trace.repository,
    entries: manifestEntries,
  });
  operations.push(...manifest.operations);
  contentArtifacts.push(...manifest.contentArtifacts);

  return { operations, contentArtifacts };
}

export function createClaudeCodeHookTraceFixture(walletAddress: string): ClaudeCodeHookTrace {
  const now = Date.now();
  const sessionId = randomUUID();
  return {
    walletAddress,
    agentId: 'sdk-claude-code-hook-canary',
    sessionId,
    turnIndex: 1,
    claudeSessionId: `claude-${sessionId}`,
    model: 'claude-sonnet-4-6',
    cwd: '/workspace/repo',
    startedAt: now,
    completedAt: now + 2,
    events: [
      { sequence: 0, hookEventName: 'SessionStart', claudeSessionId: `claude-${sessionId}`, cwd: '/workspace/repo', model: 'claude-sonnet-4-6', source: 'startup', receivedAt: now },
      { sequence: 1, hookEventName: 'PostToolUse', claudeSessionId: `claude-${sessionId}`, cwd: '/workspace/repo', model: 'claude-sonnet-4-6', receivedAt: now + 1, toolName: 'Edit', toolUseId: 'toolu_sdk', toolInput: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' }, toolResponse: { success: true } },
      { sequence: 2, hookEventName: 'Stop', claudeSessionId: `claude-${sessionId}`, cwd: '/workspace/repo', model: 'claude-sonnet-4-6', receivedAt: now + 2, reason: 'complete' },
    ],
  };
}
