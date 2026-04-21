import { supabaseAdmin } from '@/lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';

const MIGRATION_HINT =
  'Run migrations/045_conversations_star_pin_columns.sql (or 043 then 044) in Supabase SQL editor, then reload the schema.';

/** Thread row select/update failed because is_starred / is_pinned columns are missing. */
export function isMissingThreadStarPinColumnsError(err: PostgrestError | null): boolean {
  if (!err) return false;
  if (err.code === '42703') return true;
  const m = `${err.message || ''} ${err.details || ''} ${err.hint || ''}`.toLowerCase();
  return m.includes('does not exist') && m.includes('conversation_threads');
}

export function isMissingMessageStarPinColumnsError(err: PostgrestError | null): boolean {
  if (!err) return false;
  if (err.code === '42703') return true;
  const m = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return m.includes('does not exist') && m.includes('conversation_messages');
}

export function starPinMigrationHint(): string {
  return MIGRATION_HINT;
}

export async function toggleStarPinOnMessages(
  threadId: string,
  field: 'is_starred' | 'is_pinned',
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: msgs, error: mErr } = await supabaseAdmin
    .from('conversation_messages')
    .select('id, created_at, is_starred, is_pinned')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false });

  if (mErr) {
    if (isMissingMessageStarPinColumnsError(mErr)) {
      return { ok: false, error: `${mErr.message} — ${MIGRATION_HINT}`, status: 503 };
    }
    return { ok: false, error: mErr.message, status: 500 };
  }

  const list = msgs ?? [];
  const anyOn = list.some((m) => Boolean(m[field]));
  if (anyOn) {
    const { error: uErr } = await supabaseAdmin
      .from('conversation_messages')
      .update({ [field]: false })
      .eq('thread_id', threadId);
    if (uErr) return { ok: false, error: uErr.message, status: 500 };
  } else {
    const latest = list[0];
    if (!latest) {
      return {
        ok: false,
        error:
          'This conversation has no messages yet. Send a message first, or run migration 044 (thread-level star/pin).',
        status: 400,
      };
    }
    const { error: uErr } = await supabaseAdmin
      .from('conversation_messages')
      .update({ [field]: true })
      .eq('id', latest.id);
    if (uErr) return { ok: false, error: uErr.message, status: 500 };
  }
  return { ok: true };
}

/** When thread columns are missing, derive flags from any message in each thread. */
export async function starPinFlagsFromMessages(
  threadIds: string[],
): Promise<Map<string, { has_starred: boolean; has_pinned: boolean }>> {
  const map = new Map<string, { has_starred: boolean; has_pinned: boolean }>();
  for (const id of threadIds) {
    map.set(id, { has_starred: false, has_pinned: false });
  }
  if (threadIds.length === 0) return map;

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id, is_starred, is_pinned')
    .in('thread_id', threadIds);

  if (rowsErr && isMissingMessageStarPinColumnsError(rowsErr)) {
    return map;
  }

  for (const r of rows ?? []) {
    const tid = r.thread_id as string;
    const cur = map.get(tid) ?? { has_starred: false, has_pinned: false };
    if (r.is_starred) cur.has_starred = true;
    if (r.is_pinned) cur.has_pinned = true;
    map.set(tid, cur);
  }
  return map;
}
