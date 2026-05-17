import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager } from '../../src/cli/config/config-manager.js';
import { CredentialStore } from '../../src/cli/config/credential-store.js';
import { createProgram } from '../../src/cli/index.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rickydata-specialist-test-'));
}

function createNDJSONStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map(e => `${JSON.stringify(e)}\n`);
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('specialist commands', () => {
  let tmpDir: string;
  let config: ConfigManager;
  let store: CredentialStore;

  beforeEach(() => {
    tmpDir = makeTempDir();
    config = new ConfigManager(path.join(tmpDir, 'config.json'));
    store = new CredentialStore(path.join(tmpDir, 'credentials.json'));
    store.setToken('mcpwt_test', '0xabc', 'default');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('runs recommend with bounded file context and forced safety flags', async () => {
    const contextFile = path.join(tmpDir, 'example.py');
    fs.writeFileSync(contextFile, 'print("hello")\n');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body: createNDJSONStream([
        {
          type: 'complete',
          result: {
            text: 'Use Haiku for the first pass.',
            price_usd: 0.2,
            tee_proof: { available: false, manifestHash: 'sha256:test' },
          },
        },
      ]),
    } as unknown as Response);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const program = createProgram(config, store);
    await program.parseAsync([
      'node', 'rickydata', 'specialist', 'recommend',
      '--prompt', 'Which model should I use?',
      '--path', contextFile,
      '--model', 'haiku-4.5',
      '--json',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls.map((call) => call.join(' ')).join('\n'));
    expect(output.text).toContain('Haiku');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('haiku-4.5');
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toEqual(expect.objectContaining({ content: 'print("hello")\n', mimeType: 'text/plain' }));
    expect(body.files[0]).not.toHaveProperty('relativePath');
    expect(body.safety_flags).toEqual(expect.objectContaining({
      persistConversations: false,
      recordConversationTrace: false,
      disableClaudeCodeHooks: true,
      disableCodexHooks: true,
      retainUploadedFiles: false,
      returnTeeDeletionProof: true,
    }));
  });
});
