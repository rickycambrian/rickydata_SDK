export class KfdbHttpError extends Error {
  readonly status: number;
  readonly action: string;

  constructor(status: number, action: string) {
    super(`Failed to ${action}: ${status}`);
    this.name = 'KfdbHttpError';
    this.status = status;
    this.action = action;
  }
}
