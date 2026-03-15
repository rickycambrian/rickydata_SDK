import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnswerSheetClient } from '../src/answer-sheets/answer-sheet-client.js';
import type {
  AnswerSheet,
  AnswerSheetSearchResult,
  CreateAnswerSheetRequest,
  CreateAnswerSheetResponse,
  MatchAnswerSheetResult,
  AnswerSheetFeedbackResult,
} from '../src/answer-sheets/types.js';

const BASE = 'https://kfdb.rickydata.org';
const API_KEY = 'test-api-key';

function mockAnswerSheet(overrides?: Partial<AnswerSheet>): AnswerSheet {
  return {
    answer_sheet_id: 'as-001',
    tenant_id: 'tenant-1',
    error_signature: 'TypeError: .* is not a function',
    problem_category: 'type_error',
    solution_steps: [
      { step: 1, tool: 'Grep', action: 'find_definition', rationale: 'Locate the symbol' },
      { step: 2, tool: 'Edit', action: 'apply_fix', rationale: 'Fix the call site' },
    ],
    solution_summary: 'Fix incorrect function call',
    source_session_ids: ['sess-1'],
    source_extraction_ids: ['ext-1'],
    success_count: 3,
    failure_count: 1,
    confidence: 0.333,
    languages: ['typescript'],
    frameworks: [],
    tags: ['type-error'],
    version: 1,
    is_public: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    created_by: 'pipeline',
    ...overrides,
  };
}

function mockCreateRequest(): CreateAnswerSheetRequest {
  return {
    error_signature: 'ImportError: .*',
    problem_category: 'import_error',
    solution_steps: [
      { step: 1, tool: 'Bash', action: 'install_dep', rationale: 'Install missing package' },
    ],
    solution_summary: 'Install missing dependency',
  };
}

describe('AnswerSheetClient', () => {
  let client: AnswerSheetClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new AnswerSheetClient({ baseUrl: BASE, apiKey: API_KEY });
  });

  // ─── Constructor ──────────────────────────────────────────

  describe('constructor', () => {
    it('strips trailing slash from base URL', async () => {
      const slashClient = new AnswerSheetClient({ baseUrl: `${BASE}/`, apiKey: API_KEY });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 }),
      } as Response);

      await slashClient.search();

      const call = vi.mocked(fetch).mock.calls[0];
      expect((call[0] as string).startsWith(BASE + '/api/')).toBe(true);
    });
  });

  // ─── Search ───────────────────────────────────────────────

  describe('search', () => {
    it('fetches answer sheets with no filters', async () => {
      const result: AnswerSheetSearchResult = {
        items: [mockAnswerSheet()],
        total: 1,
        limit: 50,
        offset: 0,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      } as Response);

      const res = await client.search();

      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets`);
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['X-KF-API-Key']).toBe(API_KEY);
    });

    it('appends query params from options', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0, limit: 10, offset: 5 }),
      } as Response);

      await client.search({
        problem_category: 'type_error',
        language: 'typescript',
        tag: 'react',
        min_confidence: 0.5,
        is_public: true,
        limit: 10,
        offset: 5,
      });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain('problem_category=type_error');
      expect(url).toContain('language=typescript');
      expect(url).toContain('tag=react');
      expect(url).toContain('min_confidence=0.5');
      expect(url).toContain('is_public=true');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      } as Response);

      await expect(client.search()).rejects.toThrow('Failed to search answer sheets: 500 Internal Server Error');
    });
  });

  // ─── Get ──────────────────────────────────────────────────

  describe('get', () => {
    it('fetches a single answer sheet by ID', async () => {
      const sheet = mockAnswerSheet();
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(sheet),
      } as Response);

      const res = await client.get('as-001');

      expect(res.answer_sheet_id).toBe('as-001');
      expect(res.problem_category).toBe('type_error');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets/as-001`);
    });

    it('URL-encodes the ID', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAnswerSheet({ answer_sheet_id: 'id with spaces' })),
      } as Response);

      await client.get('id with spaces');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets/id%20with%20spaces`);
    });

    it('throws when id is empty', async () => {
      await expect(client.get('')).rejects.toThrow('answer_sheet_id is required');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as Response);

      await expect(client.get('missing')).rejects.toThrow('Failed to get answer sheet: 404 Not Found');
    });
  });

  // ─── Create ───────────────────────────────────────────────

  describe('create', () => {
    it('creates an answer sheet and returns slim response', async () => {
      const response: CreateAnswerSheetResponse = {
        answer_sheet_id: 'as-new',
        tenant_id: 'tenant-1',
        confidence: 0,
        created_at: '2026-03-15T00:00:00Z',
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(response),
      } as Response);

      const req = mockCreateRequest();
      const res = await client.create(req);

      expect(res.answer_sheet_id).toBe('as-new');
      expect(res.confidence).toBe(0);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets`);
      expect(call[1]?.method).toBe('POST');
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-KF-API-Key']).toBe(API_KEY);

      const body = JSON.parse(call[1]?.body as string);
      expect(body.error_signature).toBe('ImportError: .*');
      expect(body.solution_steps).toHaveLength(1);
    });

    it('throws when error_signature is missing', async () => {
      const req = mockCreateRequest();
      req.error_signature = '';
      await expect(client.create(req)).rejects.toThrow('error_signature is required');
    });

    it('throws when problem_category is missing', async () => {
      const req = mockCreateRequest();
      req.problem_category = '';
      await expect(client.create(req)).rejects.toThrow('problem_category is required');
    });

    it('throws when solution_steps is empty', async () => {
      const req = mockCreateRequest();
      req.solution_steps = [];
      await expect(client.create(req)).rejects.toThrow('solution_steps must have at least one step');
    });

    it('throws when solution_summary is missing', async () => {
      const req = mockCreateRequest();
      req.solution_summary = '';
      await expect(client.create(req)).rejects.toThrow('solution_summary is required');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      } as Response);

      await expect(client.create(mockCreateRequest())).rejects.toThrow('Failed to create answer sheet: 400 Bad Request');
    });
  });

  // ─── Update ───────────────────────────────────────────────

  describe('update', () => {
    it('sends a partial update and returns the full sheet', async () => {
      const updated = mockAnswerSheet({ solution_summary: 'Updated summary' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      } as Response);

      const res = await client.update('as-001', { solution_summary: 'Updated summary' });

      expect(res.solution_summary).toBe('Updated summary');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets/as-001`);
      expect(call[1]?.method).toBe('PUT');
      const body = JSON.parse(call[1]?.body as string);
      expect(body.solution_summary).toBe('Updated summary');
    });

    it('throws when id is empty', async () => {
      await expect(client.update('', { solution_summary: 'x' })).rejects.toThrow('answer_sheet_id is required');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as Response);

      await expect(client.update('missing', { tags: ['new'] })).rejects.toThrow('Failed to update answer sheet: 404 Not Found');
    });
  });

  // ─── Match ────────────────────────────────────────────────

  describe('match', () => {
    it('sends error text and returns ranked matches', async () => {
      const result: MatchAnswerSheetResult = {
        matches: [
          {
            answer_sheet_id: 'as-001',
            match_score: 0.95,
            match_method: 'signature',
            error_signature: 'TypeError: .* is not a function',
            problem_category: 'type_error',
            solution_summary: 'Fix incorrect function call',
            solution_steps: [{ step: 1, tool: 'Edit', action: 'fix', rationale: 'Fix it' }],
            confidence: 0.333,
            success_count: 3,
            languages: ['typescript'],
            source_session_count: 1,
          },
        ],
        total_candidates: 10,
        search_time_ms: 42,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      } as Response);

      const res = await client.match('TypeError: foo is not a function');

      expect(res.matches).toHaveLength(1);
      expect(res.matches[0].match_score).toBe(0.95);
      expect(res.total_candidates).toBe(10);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets/match`);
      expect(call[1]?.method).toBe('POST');
      const body = JSON.parse(call[1]?.body as string);
      expect(body.error_text).toBe('TypeError: foo is not a function');
    });

    it('includes context when provided', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ matches: [], total_candidates: 0, search_time_ms: 1 }),
      } as Response);

      await client.match('some error', {
        tool_name: 'Bash',
        file_path: '/src/index.ts',
        language: 'typescript',
        recent_tools: ['Grep', 'Read'],
      });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.context.tool_name).toBe('Bash');
      expect(body.context.file_path).toBe('/src/index.ts');
      expect(body.context.language).toBe('typescript');
      expect(body.context.recent_tools).toEqual(['Grep', 'Read']);
    });

    it('throws when errorText is empty', async () => {
      await expect(client.match('')).rejects.toThrow('errorText is required');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      } as Response);

      await expect(client.match('error')).rejects.toThrow('Failed to match answer sheets: 500 Server Error');
    });
  });

  // ─── Feedback ─────────────────────────────────────────────

  describe('feedback', () => {
    it('submits positive feedback and returns updated confidence', async () => {
      const result: AnswerSheetFeedbackResult = {
        feedback_id: 'fb-001',
        answer_sheet_id: 'as-001',
        old_confidence: 0.333,
        new_confidence: 0.4,
        total_success: 4,
        total_failure: 1,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      } as Response);

      const res = await client.feedback('as-001', true, {
        context: 'Fixed the issue',
        session_id: 'sess-2',
      });

      expect(res.new_confidence).toBe(0.4);
      expect(res.total_success).toBe(4);

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets/as-001/feedback`);
      expect(call[1]?.method).toBe('POST');
      const body = JSON.parse(call[1]?.body as string);
      expect(body.positive).toBe(true);
      expect(body.context).toBe('Fixed the issue');
      expect(body.session_id).toBe('sess-2');
    });

    it('submits negative feedback', async () => {
      const result: AnswerSheetFeedbackResult = {
        feedback_id: 'fb-002',
        answer_sheet_id: 'as-001',
        old_confidence: 0.333,
        new_confidence: 0.273,
        total_success: 3,
        total_failure: 2,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(result),
      } as Response);

      const res = await client.feedback('as-001', false);

      expect(res.new_confidence).toBe(0.273);
      expect(res.total_failure).toBe(2);

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.positive).toBe(false);
      expect(body.context).toBeUndefined();
      expect(body.session_id).toBeUndefined();
    });

    it('throws when id is empty', async () => {
      await expect(client.feedback('', true)).rejects.toThrow('answer_sheet_id is required');
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found'),
      } as Response);

      await expect(client.feedback('missing', true)).rejects.toThrow('Failed to submit answer sheet feedback: 404 Not Found');
    });
  });

  // ─── InitSchema ───────────────────────────────────────────

  describe('initSchema', () => {
    it('initializes schema and returns success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, message: 'Schema created' }),
      } as Response);

      const res = await client.initSchema();

      expect(res.success).toBe(true);
      expect(res.message).toBe('Schema created');

      const call = vi.mocked(fetch).mock.calls[0];
      expect(call[0]).toBe(`${BASE}/api/v1/answer-sheets/schema/init`);
      expect(call[1]?.method).toBe('POST');
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers['X-KF-API-Key']).toBe(API_KEY);
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      } as Response);

      await expect(client.initSchema()).rejects.toThrow('Failed to initialize answer sheet schema: 403 Forbidden');
    });
  });

  // ─── Error handling edge case ─────────────────────────────

  describe('throwFromResponse', () => {
    it('handles response where text() throws', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.reject(new Error('body stream error')),
      } as Response);

      await expect(client.get('x')).rejects.toThrow('Failed to get answer sheet: 502 ');
    });
  });
});
