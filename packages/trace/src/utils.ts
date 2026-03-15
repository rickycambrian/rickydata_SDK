/**
 * Utility helpers for @rickydata/trace.
 */

let counter = 0;

/** Generate a unique ID (timestamp + counter). */
export function generateId(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}

/** ISO-8601 timestamp string. */
export function formatTimestamp(): string {
  return new Date().toISOString();
}

/** Returns true when running in Node.js (not browser). */
export function isNode(): boolean {
  return typeof window === 'undefined';
}
