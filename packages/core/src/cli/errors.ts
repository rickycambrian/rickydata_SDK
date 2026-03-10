import { CommanderError } from 'commander';

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function fail(message: string, exitCode = 1): never {
  throw new CliError(message, exitCode);
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof CommanderError) {
    return new CliError(error.message, error.exitCode);
  }
  if (error instanceof Error) {
    return new CliError(error.message, 1);
  }
  return new CliError(String(error), 1);
}
