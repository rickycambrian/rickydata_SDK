import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { PipelineClient } from '../src/pipeline/pipeline-client.js';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SCRIPT_PATH = '/home/user/ai_research/scripts/resolve_issue.py';

function localClient(overrides: Record<string, unknown> = {}) {
  return new PipelineClient({
    mode: 'local',
    resolveScriptPath: SCRIPT_PATH,
    ...overrides,
  });
}

describe('PipelineClient local mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default: existsSync returns false (auto-detect tests override this)
    (existsSync as Mock).mockReturnValue(false);
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates client in local mode without baseUrl or apiKey', () => {
      const client = localClient();
      expect(client).toBeDefined();
    });

    it('defaults to remote mode when mode is not specified', () => {
      expect(() => new PipelineClient({ baseUrl: '', apiKey: '' })).toThrow(
        'baseUrl is required for remote mode',
      );
    });

    it('throws when remote mode and no baseUrl', () => {
      expect(() => new PipelineClient({ mode: 'remote', apiKey: 'key' })).toThrow(
        'baseUrl is required for remote mode',
      );
    });

    it('throws when remote mode and no apiKey', () => {
      expect(() => new PipelineClient({ mode: 'remote', baseUrl: 'http://x' })).toThrow(
        'apiKey is required for remote mode',
      );
    });

    it('accepts custom pythonPath', () => {
      const client = localClient({ pythonPath: '/usr/bin/python3.11' });
      expect(client).toBeDefined();
    });

    it('accepts custom localTimeout', () => {
      const client = localClient({ localTimeout: 60_000 });
      expect(client).toBeDefined();
    });

    it('auto-detects resolve_issue.py when resolveScriptPath not provided', () => {
      (existsSync as Mock).mockImplementation((p: string) =>
        p.includes('ai_research/scripts/resolve_issue.py'),
      );

      const client = new PipelineClient({ mode: 'local' });
      expect(client).toBeDefined();
    });

    it('throws when auto-detect fails and no resolveScriptPath', () => {
      (existsSync as Mock).mockReturnValue(false);

      expect(() => new PipelineClient({ mode: 'local' })).toThrow(
        'resolve_issue.py not found',
      );
    });
  });

  // ── resolve() ────────────────────────────────────────────────────────────

  describe('resolve()', () => {
    it('calls execFileSync with correct args', async () => {
      const jsonOutput = JSON.stringify({ pr_url: 'https://github.com/o/r/pull/1', model: 'claude-haiku', confidence: 0.8, cost: 0.01 });
      (execFileSync as Mock).mockReturnValue(jsonOutput);

      const client = localClient();
      const result = await client.resolve('owner/repo', 42);

      expect(execFileSync).toHaveBeenCalledOnce();
      const [pythonPath, args, options] = (execFileSync as Mock).mock.calls[0];
      expect(pythonPath).toBe('python3');
      expect(args).toEqual([
        SCRIPT_PATH,
        'owner/repo#42',
        '--execute', '--generate',
        '--agentic', '--auto-pr',
        '--force', '--json',
      ]);
      expect(options.timeout).toBe(1_800_000);
      expect(options.encoding).toBe('utf-8');
      expect(options.maxBuffer).toBe(50 * 1024 * 1024);
    });

    it('passes budget option to subprocess args', async () => {
      (execFileSync as Mock).mockReturnValue('{}');

      const client = localClient();
      await client.resolve('owner/repo', 1, { budget_usd: 0.75 });

      const args = (execFileSync as Mock).mock.calls[0][1];
      expect(args).toContain('--budget');
      expect(args).toContain('0.75');
    });

    it('passes timeout option to subprocess args', async () => {
      (execFileSync as Mock).mockReturnValue('{}');

      const client = localClient();
      await client.resolve('owner/repo', 1, { timeout_seconds: 300 });

      const args = (execFileSync as Mock).mock.calls[0][1];
      expect(args).toContain('--timeout');
      expect(args).toContain('300');
    });

    it('passes model option to subprocess args', async () => {
      (execFileSync as Mock).mockReturnValue('{}');

      const client = localClient();
      await client.resolve('owner/repo', 1, { model: 'claude-haiku' });

      const args = (execFileSync as Mock).mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('claude-haiku');
    });

    it('uses custom pythonPath', async () => {
      (execFileSync as Mock).mockReturnValue('{}');

      const client = localClient({ pythonPath: '/usr/local/bin/python3.12' });
      await client.resolve('owner/repo', 1);

      expect((execFileSync as Mock).mock.calls[0][0]).toBe('/usr/local/bin/python3.12');
    });

    it('uses custom localTimeout', async () => {
      (execFileSync as Mock).mockReturnValue('{}');

      const client = localClient({ localTimeout: 60_000 });
      await client.resolve('owner/repo', 1);

      expect((execFileSync as Mock).mock.calls[0][2].timeout).toBe(60_000);
    });

    it('parses JSON output and maps to PipelineResolveResponse', async () => {
      const jsonOutput = JSON.stringify({
        pr_url: 'https://github.com/owner/repo/pull/99',
        model: 'claude-haiku',
        confidence: 0.85,
        cost: 0.012,
      });
      (execFileSync as Mock).mockReturnValue(jsonOutput);

      const client = localClient();
      const result = await client.resolve('owner/repo', 42);

      expect(result.repo).toBe('owner/repo');
      expect(result.issue_number).toBe(42);
      expect(result.accepted).toBe(true);
      expect(result.pr_url).toBe('https://github.com/owner/repo/pull/99');
      expect(result.status).toBe('completed');
      expect(result.routing.model).toBe('claude-haiku');
      expect(result.routing.expected_success_rate).toBe(0.85);
      expect(result.routing.expected_cost_usd).toBe(0.012);
      expect(result.routing.reasoning).toBe('local execution via resolve_issue.py');
      expect(result.run_id).toMatch(/^local-\d+-[a-z0-9]+$/);
      expect(result.created_at).toBeTruthy();
    });

    it('maps alternative field names (pull_request_url, predicted_confidence, total_cost)', async () => {
      const jsonOutput = JSON.stringify({
        pull_request_url: 'https://github.com/o/r/pull/5',
        predicted_confidence: 0.7,
        total_cost: 0.05,
      });
      (execFileSync as Mock).mockReturnValue(jsonOutput);

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.pr_url).toBe('https://github.com/o/r/pull/5');
      expect(result.routing.expected_success_rate).toBe(0.7);
      expect(result.routing.expected_cost_usd).toBe(0.05);
    });

    it('parses JSON from last line when stdout has log lines before it', async () => {
      const stdout = [
        'INFO: Starting resolution...',
        'INFO: Cloning repo...',
        'INFO: Running code generation...',
        JSON.stringify({ pr_url: 'https://github.com/o/r/pull/7', model: 'claude-sonnet' }),
      ].join('\n');
      (execFileSync as Mock).mockReturnValue(stdout);

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.pr_url).toBe('https://github.com/o/r/pull/7');
      expect(result.routing.model).toBe('claude-sonnet');
    });

    it('returns status=completed when pr_url is present', async () => {
      (execFileSync as Mock).mockReturnValue(JSON.stringify({ pr_url: 'https://x' }));

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('completed');
    });

    it('returns status=completed when no pr_url and no error', async () => {
      (execFileSync as Mock).mockReturnValue(JSON.stringify({ model: 'claude-haiku' }));

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('completed');
    });

    it('returns status=failed when output has error field', async () => {
      (execFileSync as Mock).mockReturnValue(JSON.stringify({ error: 'compilation failed' }));

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('failed');
    });

    it('returns status=failed on subprocess error', async () => {
      (execFileSync as Mock).mockImplementation(() => {
        throw new Error('Process exited with code 1');
      });

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('failed');
      expect(result.accepted).toBe(true);
      expect(result.routing.model).toBe('unknown');
      expect(result.routing.reasoning).toContain('local execution failed');
      expect(result.routing.reasoning).toContain('Process exited with code 1');
    });

    it('truncates long error messages to 200 chars', async () => {
      const longMessage = 'x'.repeat(500);
      (execFileSync as Mock).mockImplementation(() => {
        throw new Error(longMessage);
      });

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.routing.reasoning.length).toBeLessThanOrEqual(
        'local execution failed: '.length + 200,
      );
    });

    it('handles non-Error thrown values', async () => {
      (execFileSync as Mock).mockImplementation(() => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('failed');
      expect(result.routing.reasoning).toContain('string error');
    });

    it('handles unparseable output gracefully', async () => {
      (execFileSync as Mock).mockReturnValue('not valid json at all');

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      // Should still return a valid response (with error in parsed result)
      expect(result.status).toBe('failed');
      expect(result.accepted).toBe(true);
    });

    it('uses default model when output lacks model field', async () => {
      (execFileSync as Mock).mockReturnValue(JSON.stringify({ pr_url: 'https://x' }));

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.routing.model).toBe('claude-sonnet');
    });

    it('uses default confidence when output lacks confidence field', async () => {
      (execFileSync as Mock).mockReturnValue(JSON.stringify({}));

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.routing.expected_success_rate).toBe(0.5);
    });

    it('still validates repo and issueNumber in local mode', async () => {
      const client = localClient();
      await expect(client.resolve('', 1)).rejects.toThrow('repo is required');
      await expect(client.resolve('owner/repo', 0)).rejects.toThrow('issueNumber must be a positive integer');
      await expect(client.resolve('owner/repo', -5)).rejects.toThrow('issueNumber must be a positive integer');
    });

    it('does not call fetch in local mode', async () => {
      (execFileSync as Mock).mockReturnValue('{}');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const client = localClient();
      await client.resolve('owner/repo', 1);

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── getStatus() ──────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns synthetic healthy status in local mode', async () => {
      const client = localClient();
      const status = await client.getStatus();

      expect(status.healthy).toBe(true);
      expect(status.active_runs).toBe(0);
      expect(status.total_runs).toBe(0);
      expect(status.success_rate).toBe(0);
      expect(status.roi_data).toEqual({ loaded: false });
      expect(status.checked_at).toBeTruthy();
    });

    it('does not call fetch in local mode', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const client = localClient();
      await client.getStatus();

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── reportOutcome() ──────────────────────────────────────────────────────

  describe('reportOutcome()', () => {
    it('returns recorded:true without network call in local mode', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const client = localClient();
      const result = await client.reportOutcome({
        run_id: 'local-123-abc',
        outcome: 'merged',
      });

      expect(result.recorded).toBe(true);
      expect(result.message).toContain('PredictionTracker');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('still validates run_id in local mode', async () => {
      const client = localClient();
      await expect(
        client.reportOutcome({ run_id: '', outcome: 'merged' }),
      ).rejects.toThrow('run_id is required');
    });

    it('still validates outcome in local mode', async () => {
      const client = localClient();
      await expect(
        client.reportOutcome({ run_id: 'run-1', outcome: '' as any }),
      ).rejects.toThrow('outcome type is required');
    });
  });

  // ── _detectResolveScript() ────────────────────────────────────────────────

  describe('auto-detection', () => {
    it('finds resolve_issue.py in ~/Documents/github/ai_research', () => {
      (existsSync as Mock).mockImplementation((p: string) =>
        p.includes('ai_research/scripts/resolve_issue.py'),
      );

      const client = new PipelineClient({ mode: 'local' });
      expect(client).toBeDefined();
    });

    it('finds resolve_issue.py in cwd/scripts', () => {
      (existsSync as Mock).mockImplementation((p: string) =>
        p === `${process.cwd()}/scripts/resolve_issue.py`,
      );

      const client = new PipelineClient({ mode: 'local' });
      expect(client).toBeDefined();
    });

    it('lists searched paths in error when not found', () => {
      (existsSync as Mock).mockReturnValue(false);

      expect(() => new PipelineClient({ mode: 'local' })).toThrow(
        /Searched:/,
      );
    });
  });

  // ── _parseLocalOutput() ───────────────────────────────────────────────────

  describe('output parsing', () => {
    it('parses clean JSON output', async () => {
      const json = { pr_url: 'https://github.com/o/r/pull/1', model: 'claude-haiku', confidence: 0.9, cost: 0.008 };
      (execFileSync as Mock).mockReturnValue(JSON.stringify(json));

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.pr_url).toBe('https://github.com/o/r/pull/1');
      expect(result.routing.model).toBe('claude-haiku');
      expect(result.routing.expected_success_rate).toBe(0.9);
      expect(result.routing.expected_cost_usd).toBe(0.008);
    });

    it('handles JSON preceded by log lines', async () => {
      const stdout = 'WARNING: something\nDEBUG: info\n' + JSON.stringify({ model: 'claude-sonnet' });
      (execFileSync as Mock).mockReturnValue(stdout);

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.routing.model).toBe('claude-sonnet');
    });

    it('skips invalid JSON lines and finds valid one', async () => {
      const stdout = [
        '{invalid json',
        'not json at all',
        JSON.stringify({ pr_url: 'https://x', model: 'haiku' }),
      ].join('\n');
      (execFileSync as Mock).mockReturnValue(stdout);

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.pr_url).toBe('https://x');
    });

    it('returns error when no JSON found', async () => {
      (execFileSync as Mock).mockReturnValue('no json here\njust logs');

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('failed');
    });

    it('handles empty output', async () => {
      (execFileSync as Mock).mockReturnValue('');

      const client = localClient();
      const result = await client.resolve('owner/repo', 1);

      expect(result.status).toBe('failed');
    });
  });

  // ── Backward compatibility ────────────────────────────────────────────────

  describe('backward compatibility', () => {
    it('remote mode still works with baseUrl and apiKey', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ run_id: 'r1', accepted: true }),
      } as Response);

      const client = new PipelineClient({
        baseUrl: 'https://api.example.com',
        apiKey: 'key-123',
      });

      const result = await client.resolve('owner/repo', 1);
      expect(result.run_id).toBe('r1');
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('remote mode explicitly specified works', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ run_id: 'r2' }),
      } as Response);

      const client = new PipelineClient({
        mode: 'remote',
        baseUrl: 'https://api.example.com',
        apiKey: 'key-123',
      });

      const result = await client.resolve('owner/repo', 1);
      expect(result.run_id).toBe('r2');
    });
  });
});
