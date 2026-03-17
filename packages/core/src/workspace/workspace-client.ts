/**
 * Workspace Client
 *
 * Client for managing agent workspace notes in KFDB.
 * Uses native fetch (Node 18+) -- no external dependencies.
 */

import type {
  WorkspaceNote,
  WorkspaceClientConfig,
  CreateNoteRequest,
  UpdateNoteRequest,
  ListNotesOptions,
  CheckEditsOptions,
  CheckEditsResult,
  NoteVersion,
} from './types.js';

export class WorkspaceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: WorkspaceClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  async create(data: CreateNoteRequest): Promise<{ note_id: string; success: boolean }> {
    // POST /api/v1/notes/create
    // Enforce title prefix
    if (!data.title.startsWith('agent-workspace/')) {
      throw new Error('Workspace note titles must start with "agent-workspace/"');
    }
    const res = await this.request('/api/v1/notes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) await this.throwFromResponse(res, 'create note');
    return res.json();
  }

  async update(data: UpdateNoteRequest): Promise<{ success: boolean }> {
    // PUT /api/v1/notes/update
    const res = await this.request('/api/v1/notes/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) await this.throwFromResponse(res, 'update note');
    return res.json();
  }

  async get(noteId: string, author?: string): Promise<WorkspaceNote> {
    // GET /api/v1/notes/{id}?author={wallet}
    const params = author ? `?author=${encodeURIComponent(author)}` : '';
    const res = await this.request(`/api/v1/notes/${encodeURIComponent(noteId)}${params}`);
    if (!res.ok) await this.throwFromResponse(res, 'get note');
    return res.json();
  }

  async list(options?: ListNotesOptions): Promise<WorkspaceNote[]> {
    // GET /api/v1/notes?author={wallet}
    const params = new URLSearchParams();
    if (options?.author) params.set('author', options.author);
    const qs = params.toString();
    const res = await this.request(`/api/v1/notes${qs ? '?' + qs : ''}`);
    if (!res.ok) await this.throwFromResponse(res, 'list notes');
    const notes: WorkspaceNote[] = await res.json();
    // Client-side title prefix filter
    const prefix = options?.title_prefix ?? 'agent-workspace/';
    return notes.filter(n => n.title.startsWith(prefix));
  }

  async getVersions(noteId: string): Promise<NoteVersion[]> {
    // GET /api/v1/notes/{id}/versions
    const res = await this.request(`/api/v1/notes/${encodeURIComponent(noteId)}/versions`);
    if (!res.ok) await this.throwFromResponse(res, 'get versions');
    return res.json();
  }

  async checkEdits(noteId: string, options?: CheckEditsOptions): Promise<CheckEditsResult> {
    const versions = await this.getVersions(noteId);
    const sinceVersion = options?.since_version ?? 0;
    const newVersions = versions.filter(v => v.version_number > sinceVersion);
    const currentVersion = versions.length > 0
      ? Math.max(...versions.map(v => v.version_number))
      : 0;
    return {
      note_id: noteId,
      current_version: currentVersion,
      versions: newVersions,
      has_edits: newVersions.length > 0,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-KF-API-Key': this.apiKey,
      ...(init?.headers as Record<string, string> || {}),
    };
    return globalThis.fetch(url, { ...init, headers });
  }

  private async throwFromResponse(res: Response, action: string): Promise<never> {
    let errorBody: string;
    try { errorBody = await res.text(); } catch { errorBody = ''; }
    throw new Error(`Failed to ${action}: ${res.status} ${errorBody}`);
  }
}
