import type { DeriveSession, DeriveSessionStore } from './types.js';

/**
 * In-memory derive session store.
 * Useful for tests, short-lived processes, and browser environments.
 */
export class MemoryDeriveSessionStore implements DeriveSessionStore {
  private sessions = new Map<string, DeriveSession>();

  async get(walletAddress: string): Promise<DeriveSession | null> {
    return this.sessions.get(walletAddress.toLowerCase()) ?? null;
  }

  async set(walletAddress: string, session: DeriveSession): Promise<void> {
    this.sessions.set(walletAddress.toLowerCase(), session);
  }

  async clear(walletAddress: string): Promise<void> {
    this.sessions.delete(walletAddress.toLowerCase());
  }
}

/**
 * File-backed derive session store for Node.js / CLI environments.
 *
 * Writes are atomic (write temp → rename) to prevent corruption from
 * concurrent hook processes. File permissions are set to 0600.
 *
 * File format: JSON object keyed by lowercase wallet address.
 */
export class FileDeriveSessionStore implements DeriveSessionStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async get(walletAddress: string): Promise<DeriveSession | null> {
    try {
      const { readFileSync } = await import('node:fs');
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      const session = data[walletAddress.toLowerCase()] as DeriveSession | undefined;
      return session ?? null;
    } catch {
      return null; // File missing or corrupt — treat as empty
    }
  }

  async set(walletAddress: string, session: DeriveSession): Promise<void> {
    const { readFileSync, writeFileSync, renameSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');

    let data: Record<string, DeriveSession> = {};
    try {
      data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      // Start fresh
    }

    data[walletAddress.toLowerCase()] = session;

    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    // Atomic write: temp file → rename
    const tmpPath = `${this.filePath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmpPath, this.filePath);
  }

  async clear(walletAddress: string): Promise<void> {
    const { readFileSync, writeFileSync, renameSync } = await import('node:fs');

    let data: Record<string, DeriveSession> = {};
    try {
      data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
    } catch {
      return; // Nothing to clear
    }

    delete data[walletAddress.toLowerCase()];

    const tmpPath = `${this.filePath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmpPath, this.filePath);
  }
}
