import type { KfdbResponseMeta } from './types.js';

export interface KfdbHttpErrorOptions extends Partial<KfdbResponseMeta> {
  serverMessage?: string;
  code?: string;
  details?: string;
}

export class KfdbHttpError extends Error {
  readonly status: number;
  readonly action: string;
  readonly serverMessage?: string;
  readonly code?: string;
  readonly details?: string;
  readonly requestId?: string;
  readonly backend?: string;
  readonly serverTiming?: string;
  readonly serverMs?: number;

  constructor(status: number, action: string, options: KfdbHttpErrorOptions = {}) {
    super(`Failed to ${action}: ${status}`);
    this.name = 'KfdbHttpError';
    this.status = status;
    this.action = action;
    this.serverMessage = options.serverMessage;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
    this.backend = options.backend;
    this.serverTiming = options.serverTiming;
    this.serverMs = options.serverMs;
  }
}

/** A real O(1) Entity API lookup completed and the requested entity was absent. */
export class KfdbEntityNotFoundError extends KfdbHttpError {
  readonly label: string;
  readonly id: string;

  constructor(label: string, id: string, options: KfdbHttpErrorOptions = {}) {
    super(404, 'get entity', options);
    this.name = 'KfdbEntityNotFoundError';
    this.label = label;
    this.id = id;
  }
}
