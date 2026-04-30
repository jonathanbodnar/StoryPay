import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';
import { conversationHttpError } from '@/lib/conversation-db-errors';
import {
  isMissingMessageStarPinColumnsError,
  isMissingThreadStarPinColumnsError,
  starPinFlagsFromMessages,
} from '@/lib/conversation-thread-flags';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** List threads + contact fields without PostgREST embeds (avoids FK/cache issues). */
async function fetchThreadsListManual(venueId: string) {
  const { data: rows, error: qErr } = await supabaseAdmin
    .from('conversation_threads')
    .select(
      'id, venue_id, venue_customer_id, subject, last_message_at, last_message_preview, last_message_visibility, external_reply_channel',
    )
    .eq('venue_id', venueId)
    .order('last_message_at', { ascending: false })
    .limit(120);

  if (qErr) return { ok: false as const, error: qErr };

  const customerIds = [
    ...new Set((rows ?? []).map((r) => r.venue_customer_id as string).filter(Boolean)),
  ];

  const byCustomer = new Map<
    string,
    {
      first_name?: string; last_name?: string; customer_email?: string; phone?: string | null;
      sms_dnd?: boolean; conversation_dnd_all?: boolean; conversation_dnd_email?: boolean;
      conversation_dnd_calls?: boolean; conversation_dnd_inbound_sms?: boolean;
    }
  >();

  if (customerIds.length > 0) {
    const { data: contacts, error: cErr } = await supabaseAdmin
      .from('venue_customers')
      .select('id, first_name, last_name, customer_email, phone, sms_dnd, conversation_dnd_all, conversation_dnd_email, conversation_dnd_calls, conversation_dnd_inbound_sms')
      .eq('venue_id', venueId)
      .in('id', customerIds);

    if (cErr) return { ok: false as const, error: cErr };

    for (const c of contacts ?? []) {
      const row = c as {
        id: string; first_name?: string; last_name?: string; customer_email?: string; phone?: string | null;
        sms_dnd?: boolean; conversation_dnd_all?: boolean; conversation_dnd_email?: boolean;
        conversation_dnd_calls?: boolean; conversation_dnd_inbound_sms?: boolean;
      };
      byCustomer.set(row.id, {
        first_name: row.first_name,
        last_name: row.last_name,
        customer_email: row.customer_email,
        phone: row.phone,
        sms_dnd: row.sms_dnd ?? false,
        conversation_dnd_all: row.conversation_dnd_all ?? false,
        conversation_dnd_email: row.conversation_dnd_email ?? false,
        conversation_dnd_calls: row.conversation_dnd_calls ?? false,
        conversation_dnd_inbound_sms: row.conversation_dnd_inbound_sms ?? false,
      });
    }
  }

  const mapped = (rows ?? []).map((r) => {
    const vc = byCustomer.get(r.venue_customer_id as string);
    const anyDnd = !!(vc?.sms_dnd || vc?.conversation_dnd_all || vc?.conversation_dnd_email || vc?.conversation_dnd_calls);
    return {
      thread_id: r.id,
      venue_id: r.venue_id,
      venue_customer_id: r.venue_customer_id,
      subject: r.subject,
      last_message_at: r.last_message_at,
      last_message_preview: r.last_message_preview,
      last_message_visibility: r.last_message_visibility,
      unread_count: 0,
      contact_first_name: vc?.first_name ?? '',
      contact_last_name: vc?.last_name ?? '',
      contact_email: vc?.customer_email ?? '',
      contact_phone: vc?.phone ?? null,
      external_reply_channel: (r as { external_reply_channel?: string }).external_reply_channel ?? 'email',
      // DND flags forwarded to thread list for badge display
      contact_dnd_any: anyDnd,
      contact_dnd_sms: vc?.sms_dnd ?? false,
      contact_dnd_email: vc?.conversation_dnd_email ?? false,
    };
  });

  return { ok: true as const, data: mapped };
}

async function threadIdsWithThreadColumn(
  venueId: string,
  col: 'is_starred' | 'is_pinned',
): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', venueId)
    .eq(col, true);
  if (!error) return new Set((data ?? []).map((r) => r.id as string));
  if (!isMissingThreadStarPinColumnsError(error)) return new Set();

  const { data: venueThreads } = await supabaseAdmin
    .from('conversation_threads')
    .select('id')
    .eq('venue_id', venueId);
  const tids = (venueThreads ?? []).map((t) => t.id as string);
  if (tids.length === 0) return new Set();
  const { data: msgs, error: msgErr } = await supabaseAdmin
    .from('conversation_messages')
    .select('thread_id')
    .eq(col, true)
    .in('thread_id', tids);
  if (msgErr) {
    if (isMissingMessageStarPinColumnsError(msgErr)) return new Set();
    console.warn('[conversations/threads] star/pin filter on messages:', msgErr.message);
    return new Set();
  }
  return new Set((msgs ?? []).map((m) => m.thread_id as string));
}

async function enrichThreadsWithStarPinFlags<T extends { thread_id: string }>(
  rows: T[],
  venueId: string,
): Promise<(T & { has_starred: boolean; has_pinned: boolean })[]> {
  const ids = rows.map((r) => r.thread_id);
  if (ids.length === 0) return [];
  const { data: thr, error } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, is_starred, is_pinned')
    .eq('venue_id', venueId)
    .in('id', ids);
  if (error && isMissingThreadStarPinColumnsError(error)) {
    const msgMap = await starPinFlagsFromMessages(ids);
    return rows.map((r) => {
      const f = msgMap.get(r.thread_id) ?? { has_starred: false, has_pinned: false };
      return { ...r, has_starred: f.has_starred, has_pinned: f.has_pinned };
    });
  }
  if (error) {
    console.warn('[conversations/threads] enrich star/pin:', error.message);
  }
  const byId = new Map(
    (thr ?? []).map((t) => [
      t.id as string,
      { is_starred: !!(t as { is_starred?: boolean }).is_starred, is_pinned: !!(t as { is_pinned?: boolean }).is_pinned },
    ]),
  );
  return rows.map((r) => {
    const flags = byId.get(r.thread_id);
    return {
      ...r,
      has_starred: flags?.is_starred ?? false,
      has_pinned: flags?.is_pinned ?? false,
    };
  });
}

/** Batch-attach contact_stage + contact_stage_id to every row in one trip.
 *
 *  - Resolves stage via the same chain as the profile page:
 *    venue_customers.stage_id  →  most-recent leads.stage_id (by email)
 *  - All four queries are batched with `.in()` so this stays cheap even at 120 rows.
 */
async function enrichWithStages<T extends { thread_id: string; venue_customer_id?: string | null }>(
  rows: T[],
  venueId: string,
): Promise<(T & { contact_stage: { name: string; color: string | null } | null; contact_stage_id: string | null })[]> {
  if (rows.length === 0) return rows.map((r) => ({ ...r, contact_stage: null, contact_stage_id: null }));

  const vcIds = [...new Set(rows.map((r) => r.venue_customer_id).filter((x): x is string => !!x))];
  if (vcIds.length === 0) return rows.map((r) => ({ ...r, contact_stage: null, contact_stage_id: null }));

  // 1) Pull all venue_customers (id → email + stage_id) in one query.
  const { data: vcRows } = await supabaseAdmin
    .from('venue_customers')
    .select('id, customer_email, stage_id')
    .eq('venue_id', venueId)
    .in('id', vcIds);

  type VcRow = { id: string; customer_email: string | null; stage_id: string | null };
  const vcMap = new Map<string, VcRow>(
    (vcRows ?? []).map((v) => [
      (v as VcRow).id,
      { id: (v as VcRow).id, customer_email: (v as VcRow).customer_email, stage_id: (v as VcRow).stage_id },
    ]),
  );

  // 2) Collect emails of contacts that don't already have a stage_id.
  const emailsNeedingLead = [
    ...new Set(
      [...vcMap.values()]
        .filter((v) => !v.stage_id && v.customer_email)
        .map((v) => v.customer_email!.toLowerCase().trim())
        .filter(Boolean),
    ),
  ];

  // 3) Look up the most-recent lead per email (one query, sort+dedupe in JS).
  const emailToStageId = new Map<string, string>();
  if (emailsNeedingLead.length > 0) {
    const { data: leads } = await supabaseAdmin
      .from('leads')
      .select('email, stage_id, updated_at')
      .eq('venue_id', venueId)
      .in('email', emailsNeedingLead)
      .order('updated_at', { ascending: false });
    for (const l of (leads ?? []) as { email: string | null; stage_id: string | null }[]) {
      const k = (l.email ?? '').toLowerCase().trim();
      if (!k || !l.stage_id) continue;
      if (!emailToStageId.has(k)) emailToStageId.set(k, l.stage_id);
    }
  }

  // 4) Build vcId → stageId map (vc.stage_id beats lead.stage_id).
  const vcToStageId = new Map<string, string>();
  for (const v of vcMap.values()) {
    if (v.stage_id) {
      vcToStageId.set(v.id, v.stage_id);
    } else if (v.customer_email) {
      const sid = emailToStageId.get(v.customer_email.toLowerCase().trim());
      if (sid) vcToStageId.set(v.id, sid);
    }
  }

  // 5) Resolve all stage names+colors in one query.
  const stageIds = [...new Set(vcToStageId.values())];
  const stageMap = new Map<string, { name: string; color: string | null }>();
  if (stageIds.length > 0) {
    const { data: stages } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name, color')
      .eq('venue_id', venueId)
      .in('id', stageIds);
    for (const s of (stages ?? []) as { id: string; name: string; color: string | null }[]) {
      stageMap.set(s.id, { name: s.name, color: s.color ?? null });
    }
  }

  return rows.map((r) => {
    const sid = r.venue_customer_id ? vcToStageId.get(r.venue_customer_id) ?? null : null;
    const stage = sid ? stageMap.get(sid) ?? null : null;
    return { ...r, contact_stage: stage, contact_stage_id: sid };
  });
}

/** Pinned threads first; then by last activity (newest first). */
function sortThreadsPinnedFirst<
  T extends { has_pinned?: boolean; last_message_at?: string | null },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ap = a.has_pinned ? 1 : 0;
    const bp = b.has_pinned ? 1 : 0;
    if (bp !== ap) return bp - ap;
    const at = new Date(a.last_message_at ?? 0).getTime();
    const bt = new Date(b.last_message_at ?? 0).getTime();
    return bt - at;
  });
}

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const unreadOnly = request.nextUrl.searchParams.get('unread') === '1';
  const starredOnly = request.nextUrl.searchParams.get('starred') === '1';
  const pinnedOnly = request.nextUrl.searchParams.get('pinned') === '1';
  const readerRef = conversationReaderRef(user);

  const { data, error } = await supabaseAdmin.rpc('conversation_threads_with_meta', {
    p_venue_id: venueId,
    p_reader_ref: readerRef,
    p_unread_only: unreadOnly,
    p_limit: 120,
  });

  if (error) {
    console.error('[conversations/threads GET rpc]', error);
    const manual = await fetchThreadsListManual(venueId);
    if (!manual.ok) {
      const { status, body } = conversationHttpError(manual.error);
      return NextResponse.json(body, { status });
    }
    let rows = manual.data;
    if (starredOnly) {
      const ok = await threadIdsWithThreadColumn(venueId, 'is_starred');
      rows = rows.filter((r) => ok.has(r.thread_id));
    }
    if (pinnedOnly) {
      const ok = await threadIdsWithThreadColumn(venueId, 'is_pinned');
      rows = rows.filter((r) => ok.has(r.thread_id));
    }
    const enriched = sortThreadsPinnedFirst(await enrichThreadsWithStarPinFlags(rows, venueId));
    const withStages = await enrichWithStages(enriched, venueId);
    return NextResponse.json(withStages);
  }

  let rows = (data ?? []) as { thread_id: string; venue_customer_id?: string | null; last_message_at?: string }[];
  if (starredOnly) {
    const ok = await threadIdsWithThreadColumn(venueId, 'is_starred');
    rows = rows.filter((r) => ok.has(r.thread_id));
  }
  if (pinnedOnly) {
    const ok = await threadIdsWithThreadColumn(venueId, 'is_pinned');
    rows = rows.filter((r) => ok.has(r.thread_id));
  }
  const enriched = sortThreadsPinnedFirst(await enrichThreadsWithStarPinFlags(rows, venueId));
  const withStages = await enrichWithStages(enriched, venueId);
  return NextResponse.json(withStages);
}

export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const venueCustomerId = body.venue_customer_id as string | undefined;
  const subject = typeof body.subject === 'string' && body.subject.trim() ? body.subject.trim() : 'Conversation';

  if (!venueCustomerId) {
    return NextResponse.json({ error: 'venue_customer_id is required' }, { status: 400 });
  }

  const { data: vc, error: vcErr } = await supabaseAdmin
    .from('venue_customers')
    .select('id')
    .eq('venue_id', venueId)
    .eq('id', venueCustomerId)
    .maybeSingle();

  if (vcErr || !vc) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const { data: thread, error: insErr } = await supabaseAdmin
    .from('conversation_threads')
    .insert({
      venue_id: venueId,
      venue_customer_id: venueCustomerId,
      subject,
    })
    .select('id')
    .single();

  if (insErr || !thread) {
    console.error('[conversations/threads POST]', insErr);
    const { status, body } = conversationHttpError(insErr);
    return NextResponse.json(body, { status });
  }

  return NextResponse.json({ id: thread.id }, { status: 201 });
}
