import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { conversationReaderRef } from '@/lib/conversation-reader';
import { conversationHttpError } from '@/lib/conversation-db-errors';

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
    { first_name?: string; last_name?: string; customer_email?: string; phone?: string | null }
  >();

  if (customerIds.length > 0) {
    const { data: contacts, error: cErr } = await supabaseAdmin
      .from('venue_customers')
      .select('id, first_name, last_name, customer_email, phone')
      .eq('venue_id', venueId)
      .in('id', customerIds);

    if (cErr) return { ok: false as const, error: cErr };

    for (const c of contacts ?? []) {
      const row = c as {
        id: string;
        first_name?: string;
        last_name?: string;
        customer_email?: string;
        phone?: string | null;
      };
      byCustomer.set(row.id, {
        first_name: row.first_name,
        last_name: row.last_name,
        customer_email: row.customer_email,
        phone: row.phone,
      });
    }
  }

  const mapped = (rows ?? []).map((r) => {
    const vc = byCustomer.get(r.venue_customer_id as string);
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
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.id as string));
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
    return NextResponse.json(enriched);
  }

  let rows = (data ?? []) as { thread_id: string; last_message_at?: string }[];
  if (starredOnly) {
    const ok = await threadIdsWithThreadColumn(venueId, 'is_starred');
    rows = rows.filter((r) => ok.has(r.thread_id));
  }
  if (pinnedOnly) {
    const ok = await threadIdsWithThreadColumn(venueId, 'is_pinned');
    rows = rows.filter((r) => ok.has(r.thread_id));
  }
  const enriched = sortThreadsPinnedFirst(await enrichThreadsWithStarPinFlags(rows, venueId));
  return NextResponse.json(enriched);
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
