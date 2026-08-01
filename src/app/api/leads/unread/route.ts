import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Unread-message rollups for the Leads view.
 *
 * Returns two maps so the Leads page can (a) badge each pipeline stage in the
 * filter dropdown with the number of unread messages sitting in that stage and
 * (b) flag individual leads that have unread conversations:
 *
 *   { byStage: { [stageId]: count }, emails: { [lowercaseEmail]: count } }
 *
 * Unread is sourced from the same RPC the conversations inbox uses, then each
 * thread's contact is resolved to a stage via venue_customers.stage_id, falling
 * back to the most-recent lead by email (mirrors the inbox stage enrichment).
 */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const readerRef = conversationReaderRef(user);
  const { data, error } = await supabaseAdmin.rpc('conversation_threads_with_meta', {
    p_venue_id: venueId,
    p_reader_ref: readerRef,
    p_unread_only: true,
    p_limit: 500,
  });

  if (error) {
    console.error('[leads/unread]', error);
    return NextResponse.json({ byStage: {}, emails: {} });
  }

  const rows = (data ?? []) as { venue_customer_id?: string | null; unread_count?: number | string }[];

  // Sum unread per contact (a contact can have multiple threads).
  const byVc = new Map<string, number>();
  for (const r of rows) {
    const vc = r.venue_customer_id;
    const n = Number(r.unread_count ?? 0);
    if (!vc || n <= 0) continue;
    byVc.set(vc, (byVc.get(vc) ?? 0) + n);
  }

  const byStage: Record<string, number> = {};
  const emails: Record<string, number> = {};

  const vcIds = [...byVc.keys()];
  if (vcIds.length > 0) {
    const { data: vcs } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, stage_id')
      .in('id', vcIds);

    type Vc = { id: string; customer_email: string | null; stage_id: string | null };
    const vcRows = (vcs ?? []) as Vc[];

    // For contacts without their own stage, fall back to the newest lead's stage.
    const needLead = [
      ...new Set(
        vcRows
          .filter((v) => !v.stage_id && v.customer_email)
          .map((v) => v.customer_email!.toLowerCase().trim()),
      ),
    ];
    const emailToStage = new Map<string, string>();
    if (needLead.length > 0) {
      const { data: leadRows } = await supabaseAdmin
        .from('leads')
        .select('email, stage_id, updated_at')
        .eq('venue_id', venueId)
        .in('email', needLead)
        .order('updated_at', { ascending: false });
      for (const l of (leadRows ?? []) as { email: string | null; stage_id: string | null }[]) {
        const k = (l.email ?? '').toLowerCase().trim();
        if (!k || !l.stage_id || emailToStage.has(k)) continue;
        emailToStage.set(k, l.stage_id);
      }
    }

    for (const v of vcRows) {
      const count = byVc.get(v.id) ?? 0;
      if (count <= 0) continue;
      const email = (v.customer_email ?? '').toLowerCase().trim();
      if (email) emails[email] = (emails[email] ?? 0) + count;
      const sid = v.stage_id ?? (email ? emailToStage.get(email) ?? null : null);
      if (sid) byStage[sid] = (byStage[sid] ?? 0) + count;
    }
  }

  return NextResponse.json({ byStage, emails });
}
