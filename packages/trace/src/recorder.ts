/**
 * TraceRecorder — records agent interaction events.
 *
 * Node.js: writes newline-delimited JSON to {outputDir}/{sessionId}.jsonl
 * Browser: buffers events in memory, exposed via getSession()
 */

import type { TraceEvent, TraceSession, TraceRecorderConfig } from './types.js';
import { generateId, formatTimestamp, isNode } from './utils.js';

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export class TraceRecorder {
  private config: Required<
    Pick<TraceRecorderConfig, 'format' | 'maxFileSize' | 'enabled'>
  > & TraceRecorderConfig;

  private sessions = new Map<string, TraceSession>();
  private activeSessionId: string | null = null;
  private outputDir: string | null = null;

  // Node.js modules loaded lazily
  private fs: typeof import('node:fs') | null = null;
  private path: typeof import('node:path') | null = null;

  constructor(config?: TraceRecorderConfig) {
    this.config = {
      format: 'jsonl',
      maxFileSize: DEFAULT_MAX_FILE_SIZE,
      enabled: true,
      ...config,
    };
  }

  // ─── Session lifecycle ──────────────────────────────────────

  /** Start a new trace session. Returns the session ID. */
  startSession(agentId: string, metadata?: Record<string, unknown>): string {
    const id = generateId();
    const session: TraceSession = {
      id,
      agentId,
      startedAt: formatTimestamp(),
      events: [],
      metadata: { ...this.config.sessionMetadata, ...metadata },
    };
    this.sessions.set(id, session);
    this.activeSessionId = id;

    this.record({
      type: 'session_start',
      sessionId: id,
      agentId,
      data: { metadata: session.metadata },
    });

    return id;
  }

  /** End a trace session. */
  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.record({
      type: 'session_end',
      sessionId,
      agentId: session.agentId,
      data: {
        eventCount: session.events.length,
        durationMs: Date.now() - new Date(session.startedAt).getTime(),
      },
    });

    session.endedAt = formatTimestamp();
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  // ─── Recording ──────────────────────────────────────────────

  /** Record a trace event. Returns the full event with generated id/timestamp. */
  record(event: Omit<TraceEvent, 'id' | 'timestamp'>): TraceEvent {
    if (!this.config.enabled) {
      return { id: '', timestamp: '', ...event };
    }

    const full: TraceEvent = {
      id: generateId(),
      timestamp: formatTimestamp(),
      ...event,
    };

    // Add to in-memory session
    const sid = full.sessionId ?? this.activeSessionId;
    if (sid) {
      const session = this.sessions.get(sid);
      if (session) {
        session.events.push(full);
      }
    }

    // Write to disk in Node.js
    if (isNode()) {
      this.writeEvent(full);
    }

    // Invoke callback
    this.config.onEvent?.(full);

    return full;
  }

  // ─── Queries ────────────────────────────────────────────────

  /** Get a session by ID. */
  getSession(sessionId: string): TraceSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** Get the currently active session. */
  getActiveSession(): TraceSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) ?? null;
  }

  /** Flush buffered events to disk (Node.js only, no-op in browser). */
  async flush(): Promise<void> {
    // In the JSONL write-through strategy, events are already written
    // synchronously. This method exists for future batched-write support.
  }

  // ─── Internal: file writing (Node.js only) ──────────────────

  private writeEvent(event: TraceEvent): void {
    if (!isNode()) return;

    try {
      // Lazy-load Node.js modules
      if (!this.fs) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.fs = require('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        this.path = require('node:path');
      }

      const dir = this.resolveOutputDir();
      this.fs!.mkdirSync(dir, { recursive: true });

      const sessionId = event.sessionId ?? this.activeSessionId ?? 'default';
      const filePath = this.path!.join(dir, `${sessionId}.jsonl`);

      // Check file size for rotation
      try {
        const stat = this.fs!.statSync(filePath);
        if (stat.size >= this.config.maxFileSize) {
          const rotated = `${filePath}.${Date.now()}`;
          this.fs!.renameSync(filePath, rotated);
        }
      } catch {
        // File doesn't exist yet — that's fine
      }

      this.fs!.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Non-fatal: trace writing should never crash the host application
    }
  }

  private resolveOutputDir(): string {
    if (this.outputDir) return this.outputDir;

    if (this.config.outputDir) {
      this.outputDir = this.config.outputDir;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const os = require('node:os') as typeof import('node:os');
      this.outputDir = this.path!.join(os.homedir(), '.claude', 'traces');
    }

    return this.outputDir;
  }
}
