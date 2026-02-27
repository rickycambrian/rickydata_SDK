import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function createTestStore(): CredentialStore {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-test-'));
  return new CredentialStore(path.join(tmp, 'credentials.json'));
}

function createTestConfig(): ConfigManager {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-test-'));
  return new ConfigManager(path.join(tmp, 'config.json'));
}

describe('init command', () => {
  let config: ConfigManager;
  let store: CredentialStore;

  beforeEach(() => {
    config = createTestConfig();
    store = createTestStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers as a top-level command', () => {
    const program = createProgram(config, store);
    const initCmd = program.commands.find((c) => c.name() === 'init');
    expect(initCmd).toBeDefined();
    expect(initCmd!.description()).toContain('Set up rickydata');
  });

  it('has --yes, --skip-verify, and --profile options', () => {
    const program = createProgram(config, store);
    const initCmd = program.commands.find((c) => c.name() === 'init');
    const optionNames = initCmd!.options.map((o) => o.long);
    expect(optionNames).toContain('--yes');
    expect(optionNames).toContain('--skip-verify');
    expect(optionNames).toContain('--profile');
  });

  it('appears before auth in command order', () => {
    const program = createProgram(config, store);
    const names = program.commands.map((c) => c.name());
    expect(names.indexOf('init')).toBeLessThan(names.indexOf('auth'));
  });
});
