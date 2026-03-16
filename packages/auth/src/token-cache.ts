import type { CachedToken } from './types.js';
import { STORAGE_KEY, LEGACY_STORAGE_KEYS, TOKEN_REFRESH_MARGIN_MS } from './constants.js';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJSON<T>(key: string): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — silently ignore
  }
}

function removeKey(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

/**
 * Attempt to migrate a legacy token entry into a CachedToken shape.
 * Legacy entries may be a plain token string or a partial object.
 */
function migrateLegacy(raw: unknown): CachedToken | null {
  if (!raw) return null;

  // Plain string token (oldest format)
  if (typeof raw === 'string') {
    return {
      token: raw,
      address: '',
      expiresAt: 0,
      storedAt: Date.now(),
    };
  }

  // Object with at least a token field
  if (typeof raw === 'object' && raw !== null && 'token' in raw) {
    const obj = raw as Record<string, unknown>;
    return {
      token: String(obj.token),
      address: typeof obj.address === 'string' ? obj.address : '',
      tenantId: typeof obj.tenantId === 'string' ? obj.tenantId : undefined,
      expiresAt: typeof obj.expiresAt === 'number' ? obj.expiresAt : 0,
      storedAt: typeof obj.storedAt === 'number' ? obj.storedAt : Date.now(),
    };
  }

  return null;
}

/**
 * Check if a cached token is still valid (not expired, accounting for refresh margin).
 */
export function isTokenValid(token: CachedToken): boolean {
  if (!token.token) return false;
  // If expiresAt is 0 or unknown, treat as valid (we cannot determine expiry)
  if (!token.expiresAt) return true;
  return Date.now() < token.expiresAt - TOKEN_REFRESH_MARGIN_MS;
}

/**
 * Retrieve a cached token.
 * Checks the current storage key first, then falls back to legacy keys
 * and migrates if found.
 */
export function getToken(): CachedToken | null {
  // 1. Check current key
  const current = readJSON<CachedToken>(STORAGE_KEY);
  if (current?.token) return current;

  // 2. Fall back to legacy keys
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    const raw = readJSON<unknown>(legacyKey);
    const migrated = migrateLegacy(raw);
    if (migrated) {
      // Migrate to unified key and remove legacy entry
      writeJSON(STORAGE_KEY, migrated);
      removeKey(legacyKey);
      return migrated;
    }
  }

  return null;
}

/**
 * Store a token under the unified storage key.
 */
export function setToken(token: CachedToken): void {
  writeJSON(STORAGE_KEY, token);
}

/**
 * Clear all stored tokens (current key + all legacy keys).
 */
export function clearToken(): void {
  removeKey(STORAGE_KEY);
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    removeKey(legacyKey);
  }
}
