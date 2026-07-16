import type { KnowledgeWorkCacheEntry, KnowledgeWorkCacheStore } from './types.js';

export interface MemoryKnowledgeWorkCacheStoreOptions {
  maxEntries?: number;
}

/** Bounded LRU cache suitable for Node hosts and browser sessions. */
export class MemoryKnowledgeWorkCacheStore implements KnowledgeWorkCacheStore {
  private readonly entries = new Map<string, KnowledgeWorkCacheEntry>();
  private readonly maxEntries: number;

  constructor(options: MemoryKnowledgeWorkCacheStoreOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 128);
  }

  async get(key: string): Promise<KnowledgeWorkCacheEntry | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  async set(key: string, entry: KnowledgeWorkCacheEntry): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clearScope(scope: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.scope === scope) this.entries.delete(key);
    }
  }
}

export interface IndexedDbKnowledgeWorkCacheStoreOptions {
  databaseName?: string;
  storeName?: string;
  maxEntries?: number;
}

/**
 * Persistent browser adapter. It is opt-in so hosts decide whether private,
 * decrypted knowledge may be stored on the device. Entries remain tenant
 * scoped and the client clears the previous scope when a wallet changes.
 */
export class IndexedDbKnowledgeWorkCacheStore implements KnowledgeWorkCacheStore {
  private readonly databaseName: string;
  private readonly storeName: string;
  private readonly maxEntries: number;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbKnowledgeWorkCacheStoreOptions = {}) {
    this.databaseName = options.databaseName ?? 'rickydata-knowledge-work';
    this.storeName = options.storeName ?? 'context-packs';
    this.maxEntries = Math.max(1, options.maxEntries ?? 256);
  }

  async get(key: string): Promise<KnowledgeWorkCacheEntry | null> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction(this.storeName).objectStore(this.storeName).get(key);
      request.onsuccess = () => resolve((request.result as KnowledgeWorkCacheEntry | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async set(key: string, entry: KnowledgeWorkCacheEntry): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    await this.prune(db);
  }

  async delete(key: string): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearScope(scope: string): Promise<void> {
    const db = await this.db();
    const rows = await this.all(db);
    const keys = rows.filter((row) => row.entry.scope === scope).map((row) => row.key);
    if (keys.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const key of keys) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const factory = globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is unavailable in this host');
    this.dbPromise = new Promise((resolve, reject) => {
      const request = factory.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  private all(db: IDBDatabase): Promise<Array<{ key: IDBValidKey; entry: KnowledgeWorkCacheEntry }>> {
    return new Promise((resolve, reject) => {
      const request = db.transaction(this.storeName).objectStore(this.storeName).openCursor();
      const rows: Array<{ key: IDBValidKey; entry: KnowledgeWorkCacheEntry }> = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(rows);
        rows.push({ key: cursor.key, entry: cursor.value as KnowledgeWorkCacheEntry });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async prune(db: IDBDatabase): Promise<void> {
    const rows = await this.all(db);
    if (rows.length <= this.maxEntries) return;
    rows.sort((a, b) => a.entry.storedAt - b.entry.storedAt);
    const remove = rows.slice(0, rows.length - this.maxEntries);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const row of remove) store.delete(row.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
