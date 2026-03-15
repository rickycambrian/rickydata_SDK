/**
 * File-backed session store with 24-hour TTL.
 *
 * Persists agent session IDs to ~/.rickydata/sessions.json so sessions
 * survive across CLI invocations and process restarts.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface SessionEntry {
  sessionId: string;
  lastUsed: number; // timestamp
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SessionStore {
  private cache: Map<string, SessionEntry>;
  private readonly filePath: string | null;
  private dirty = false;

  /**
   * @param filePath — explicit path, or omit for default (~/.rickydata/sessions.json).
   *                    Pass `null` for a pure in-memory store (useful in tests).
   */
  constructor(filePath?: string | null) {
    this.filePath = filePath === null ? null : (filePath ?? join(homedir(), '.rickydata', 'sessions.json'));
    this.cache = new Map();
    this.load();
  }

  get(agentId: string): string | undefined {
    const entry = this.cache.get(agentId);
    if (!entry) return undefined;
    if (Date.now() - entry.lastUsed > SESSION_TTL_MS) {
      this.cache.delete(agentId);
      this.dirty = true;
      this.save();
      return undefined;
    }
    return entry.sessionId;
  }

  set(agentId: string, sessionId: string): void {
    this.cache.set(agentId, { sessionId, lastUsed: Date.now() });
    this.dirty = true;
    this.save();
  }

  private load(): void {
    if (!this.filePath) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const data: Record<string, SessionEntry> = JSON.parse(raw);
      for (const [key, entry] of Object.entries(data)) {
        if (entry && typeof entry.sessionId === 'string' && typeof entry.lastUsed === 'number') {
          this.cache.set(key, entry);
        }
      }
    } catch {
      // File doesn't exist or is malformed — start with empty cache
    }
  }

  private save(): void {
    if (!this.dirty || !this.filePath) return;
    try {
      const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));
      mkdirSync(dir, { recursive: true });
      const obj: Record<string, SessionEntry> = {};
      for (const [key, entry] of this.cache) {
        obj[key] = entry;
      }
      writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
      this.dirty = false;
    } catch {
      // Best-effort persistence — don't crash if write fails
    }
  }
}
