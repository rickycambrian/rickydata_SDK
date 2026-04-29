import type { KfdbPropertyValue } from './types.js';

export const kfdbValue = {
  string(value: string): KfdbPropertyValue {
    return { String: value };
  },
  integer(value: number): KfdbPropertyValue {
    return { Integer: value };
  },
  float(value: number): KfdbPropertyValue {
    return { Float: value };
  },
  boolean(value: boolean): KfdbPropertyValue {
    return { Boolean: value };
  },
  vector(value: number[]): KfdbPropertyValue {
    return { Vector: value };
  },
  auto(value: unknown): KfdbPropertyValue | null {
    if (value == null) return null;
    if (typeof value === 'string') return { String: value };
    if (typeof value === 'boolean') return { Boolean: value };
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { Integer: value } : { Float: value };
    }
    if (Array.isArray(value) && value.every(item => typeof item === 'number')) {
      return { Vector: value };
    }
    return { String: JSON.stringify(value) };
  },
} as const;
