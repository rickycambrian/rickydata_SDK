/**
 * Workspace Note Type Definitions
 *
 * Types for the agent workspace system -- structured notes that enable
 * bidirectional communication between autonomous agents and human operators.
 */

// ── Core Entity ────────────────────────────────────────────────────────────

export interface WorkspaceNote {
  id: string;
  title: string;
  content: string;
  author: string;
  created_at: number;
  updated_at: number;
}

export interface NoteVersion {
  note_id: string;
  version_number: number;
  title: string;
  created_at: number;
  change_summary: string;
  content_hash: string;
}

// ── Requests ────────────────────────────────────────────────────────────

export interface CreateNoteRequest {
  title: string;
  content: string;
  author?: string;
}

export interface UpdateNoteRequest {
  note_id: string;
  title?: string;
  content: string;
}

// ── Options ────────────────────────────────────────────────────────────

export interface ListNotesOptions {
  author?: string;
  title_prefix?: string;
}

export interface CheckEditsOptions {
  since_version?: number;
}

export interface CheckEditsResult {
  note_id: string;
  current_version: number;
  versions: NoteVersion[];
  has_edits: boolean;
}

// ── Config ────────────────────────────────────────────────────────────

export interface WorkspaceClientConfig {
  baseUrl: string;
  apiKey: string;
}
