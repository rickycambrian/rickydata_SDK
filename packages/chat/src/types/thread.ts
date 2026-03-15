/** Thread metadata. */
export interface Thread {
  id: string;
  title: string;
  context_type?: string;
  context_ref_id?: string;
  entity_id?: string;
  status?: string;
  created_at: string;
  updated_at: string;
}

/** Summary for thread list display. */
export interface ThreadListItem {
  id: string;
  title: string;
  context_type?: string;
  updated_at: string;
}
