export type RealtimeConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface RealtimeConnectionStateSnapshot {
  status: RealtimeConnectionStatus;
  reconnectAttempts: number;
  lastEventId?: string;
  lastMessageAt?: number;
  error?: Error;
}

export interface ParsedSSEChunk {
  id?: string;
  event?: string;
  retry?: number;
  data?: string;
  comments: string[];
}

export interface RealtimeJsonEvent<T = unknown> {
  id?: string;
  event?: string;
  data: T;
  raw: string;
}

export interface RealtimeRetryOptions {
  initialMs?: number;
  maxMs?: number;
  maxRetries?: number;
  jitter?: boolean;
}

export interface StreamSSEOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  heartbeatTimeoutMs?: number;
}

export interface StreamSSEJsonOptions extends StreamSSEOptions {
  headers?: HeadersInit;
  lastEventId?: string;
  after?: string;
  retry?: RealtimeRetryOptions;
  onConnectionState?: (state: RealtimeConnectionStateSnapshot) => void;
}

export interface RealtimeConnectionState {
  getSnapshot(): RealtimeConnectionStateSnapshot;
  subscribe(listener: (state: RealtimeConnectionStateSnapshot) => void): () => void;
  setConnecting(): void;
  setConnected(lastEventId?: string): void;
  setReconnecting(reconnectAttempts: number, error?: Error): void;
  setClosed(): void;
  setError(error: Error): void;
}

export function createRealtimeConnectionState(
  onChange?: (state: RealtimeConnectionStateSnapshot) => void,
): RealtimeConnectionState {
  let snapshot: RealtimeConnectionStateSnapshot = {
    status: 'idle',
    reconnectAttempts: 0,
  };
  const listeners = new Set<(state: RealtimeConnectionStateSnapshot) => void>();

  const emit = (next: RealtimeConnectionStateSnapshot) => {
    snapshot = next;
    onChange?.({ ...snapshot });
    for (const listener of listeners) {
      listener({ ...snapshot });
    }
  };

  return {
    getSnapshot: () => ({ ...snapshot }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...snapshot });
      return () => {
        listeners.delete(listener);
      };
    },
    setConnecting() {
      emit({
        ...snapshot,
        status: 'connecting',
        error: undefined,
      });
    },
    setConnected(lastEventId?: string) {
      emit({
        ...snapshot,
        status: 'connected',
        lastEventId: lastEventId ?? snapshot.lastEventId,
        lastMessageAt: Date.now(),
        error: undefined,
      });
    },
    setReconnecting(reconnectAttempts: number, error?: Error) {
      emit({
        ...snapshot,
        status: 'reconnecting',
        reconnectAttempts,
        error,
      });
    },
    setClosed() {
      emit({
        ...snapshot,
        status: 'closed',
        error: undefined,
      });
    },
    setError(error: Error) {
      emit({
        ...snapshot,
        status: 'error',
        error,
      });
    },
  };
}

export function parseSSEChunk(chunk: string): ParsedSSEChunk {
  const normalized = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const dataLines: string[] = [];
  const comments: string[] = [];
  let id: string | undefined;
  let event: string | undefined;
  let retry: number | undefined;

  for (const line of lines) {
    if (line === '') continue;
    if (line.startsWith(':')) {
      comments.push(line.slice(1).trimStart());
      continue;
    }

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    switch (field) {
      case 'id':
        id = value;
        break;
      case 'event':
        event = value;
        break;
      case 'retry': {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) retry = parsed;
        break;
      }
      case 'data':
        dataLines.push(value);
        break;
    }
  }

  return {
    ...(id !== undefined ? { id } : {}),
    ...(event !== undefined ? { event } : {}),
    ...(retry !== undefined ? { retry } : {}),
    ...(dataLines.length > 0 ? { data: dataLines.join('\n') } : {}),
    comments,
  };
}

export async function* streamSSEJsonFromResponse<T = unknown>(
  response: Response,
  options: StreamSSEOptions = {},
): AsyncGenerator<RealtimeJsonEvent<T>, void, undefined> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const controller = new AbortController();
  const userSignal = options.signal;
  if (userSignal) {
    if (userSignal.aborted) {
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), { once: true });
    }
  }

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  controller.signal.addEventListener('abort', onAbort, { once: true });

  const decoder = new TextDecoder();
  let buffer = '';
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

  if (options.timeoutMs != null) {
    overallTimer = setTimeout(
      () => controller.abort(new Error(`SSE stream timed out after ${options.timeoutMs}ms`)),
      options.timeoutMs,
    );
  }

  const resetHeartbeat = () => {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (options.heartbeatTimeoutMs != null && options.heartbeatTimeoutMs > 0) {
      heartbeatTimer = setTimeout(
        () => controller.abort(new Error(`SSE stream idle for ${options.heartbeatTimeoutMs}ms`)),
        options.heartbeatTimeoutMs,
      );
    }
  };

  const clearTimers = () => {
    if (overallTimer) clearTimeout(overallTimer);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
  };

  resetHeartbeat();

  try {
    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          throw reason instanceof Error ? reason : new Error(String(reason ?? 'Stream aborted'));
        }
        throw err;
      }

      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        throw reason instanceof Error ? reason : new Error(String(reason ?? 'Stream aborted'));
      }

      const { done, value } = readResult;
      if (done) break;

      resetHeartbeat();
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSSEChunk(chunk);
        if (parsed.data) {
          if (parsed.data === '[DONE]') return;
          try {
            const data = JSON.parse(parsed.data) as T;
            yield {
              ...(parsed.id !== undefined ? { id: parsed.id } : {}),
              ...(parsed.event !== undefined ? { event: parsed.event } : {}),
              data,
              raw: parsed.data,
            };
          } catch {
            // Preserve legacy behavior: malformed JSON events are ignored.
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }

    if (buffer.trim()) {
      const parsed = parseSSEChunk(buffer);
      if (parsed.data && parsed.data !== '[DONE]') {
        try {
          const data = JSON.parse(parsed.data) as T;
          yield {
            ...(parsed.id !== undefined ? { id: parsed.id } : {}),
            ...(parsed.event !== undefined ? { event: parsed.event } : {}),
            data,
            raw: parsed.data,
          };
        } catch {
          // Skip malformed trailing data.
        }
      }
    }
  } finally {
    clearTimers();
    controller.signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export async function* streamSSEJson<T = unknown>(
  input: string | URL | Request,
  options: StreamSSEJsonOptions = {},
): AsyncGenerator<RealtimeJsonEvent<T>, void, undefined> {
  const retry = {
    initialMs: options.retry?.initialMs ?? 250,
    maxMs: options.retry?.maxMs ?? 5_000,
    maxRetries: options.retry?.maxRetries ?? 3,
    jitter: options.retry?.jitter ?? true,
  };
  const state = createRealtimeConnectionState(options.onConnectionState);
  let attempt = 0;
  let lastEventId = options.lastEventId;

  while (true) {
    try {
      state.setConnecting();
      const headers = new Headers(options.headers);
      if (lastEventId) {
        headers.set('Last-Event-ID', lastEventId);
      }
      const requestInput = withAfterCursor(input, options.after);
      const response = await fetch(requestInput, { headers, signal: options.signal });
      if (!response.ok) {
        throw new Error(`SSE request failed: ${response.status} ${await response.text().catch(() => '')}`.trim());
      }
      state.setConnected(lastEventId);

      for await (const event of streamSSEJsonFromResponse<T>(response, options)) {
        if (event.id) lastEventId = event.id;
        state.setConnected(lastEventId);
        yield event;
      }
      state.setClosed();
      return;
    } catch (err) {
      if (options.signal?.aborted) {
        state.setClosed();
        throw err;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt >= retry.maxRetries) {
        state.setError(error);
        throw error;
      }
      attempt += 1;
      state.setReconnecting(attempt, error);
      await sleep(backoffDelay(attempt, retry.initialMs, retry.maxMs, retry.jitter));
    }
  }
}

function withAfterCursor(input: string | URL | Request, after?: string): string | URL | Request {
  if (!after || input instanceof Request) return input;
  const url = input instanceof URL ? new URL(input.toString()) : new URL(String(input));
  url.searchParams.set('after', after);
  return url;
}

function backoffDelay(attempt: number, initialMs: number, maxMs: number, jitter: boolean): number {
  const base = Math.min(maxMs, initialMs * 2 ** Math.max(0, attempt - 1));
  if (!jitter) return base;
  return Math.floor(base * (0.5 + Math.random()));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
