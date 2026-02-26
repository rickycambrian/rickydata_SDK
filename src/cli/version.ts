import { readFileSync } from 'fs';

function readCliVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION = readCliVersion();
