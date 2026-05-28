// ============================================================================
// Store factory — selects FsStore (local) or SupabaseStore (hosted SaaS)
// ============================================================================
// DECIBEL_STORE=supabase → SupabaseStore (org-scoped Core Supabase under RLS).
// Default / unset       → FsStore (box-local .decibel files, git-tracked).
// See ADR-0007 / EPIC-0033.
// ============================================================================

import { FsStore } from './fsStore.js';
import { SupabaseStore } from './supabaseStore.js';
import type { Store } from './types.js';

export * from './types.js';
export { parseIssueMarkdown, serializeIssueMarkdown } from './markdown.js';
export { FsStore } from './fsStore.js';
export { SupabaseStore } from './supabaseStore.js';

let _store: Store | null = null;

/** Resolve the active store from config. Cached after first call. */
export function getStore(): Store {
  if (_store) return _store;
  const kind = (process.env.DECIBEL_STORE || 'fs').toLowerCase();
  _store = kind === 'supabase' ? new SupabaseStore() : new FsStore();
  return _store;
}
