/**
 * GET /api/admin/support/bride-inbox
 *
 * Returns paginated list of conversation threads (across ALL venues) where the
 * latest external message has sender_kind='contact' — i.e. the bride replied
 * and nobody has answered yet.
 *
 * Query params:
 *   venue_id?  filter to a single venue
 *   search?    matches venue name, contact name, contact email, or preview
 *   cursor?    `${last_message_at_iso}|${thread_id}` from previous page
 *   limit?     default 50, max 100
 *
 * Response: { threads: BrideInboxRow[]; nextCursor: string | null }
 *
 * Implementation note: this endpoint used to run a single CTE over a raw
 * postgres-js connection. That client routinely hit ENETUNREACH on Vercel
 * because Supabase's direct host is IPv6-only on the free tier. We've
 * since rewritten it to use supabaseAdmin (PostgREST HTTP) instead — the
 * trade-off is N+1-ish queries and JS-side dedupe, but it's bulletproof
 * across runtimes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BrideInboxRow {
  thread_id:               string;
  venue_id:                string;
  venue_name:              string;
  venue_customer_id:       string;
  contact_first_name:      string | null;
  contact_last_name:       string | null;
  contact_email:           string | null;
  contact_phone:           string | null;
  subject:                 string;
  last_message_at:         string;
  last_message_preview:    string | null;
  last_inbound_channel:    'sms' | 'email';
  last_inbound_body:       string;
  last_inbound_created_at: string;
  message_count:           number;
}

interface MessageMeta {
  thread_id:    string;
  sender_kind:  string;
  body:         string;
  channel:      string;
  created_at:   string;
}

interface ThreadRow {
  id:                   string;
  venue_id:             string;
  venue_customer_id:    string;
  subject:              string | null;
  last_message_at:      string;
  last_message_preview: string | null;
}

interface VenueRow {
  id:   string;
  name: string;
}

interface VenueCustomerRow {
  id:             string;
  first_name:     string | null;
  last_name:      string | null;
  customer_email: string | null;
  phone:          string | null;
}

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url      = new URL(req.url);
  const venueId  = (url.searchParams.get('venue_id') || '').trim();
  const search   = (url.searchParams.get('search') || '').trim().toLowerCase();
  const cursor   = (url.searchParams.get('cursor') || '').trim();
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit    = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));
  // 'open' = bride replied + unanswered (default)
  // 'all'  = all threads
  // 'closed' = venue/support replied last
  const filter   = (url.searchParams.get('filter') || 'open') as 'open' | 'all' | 'closed';

  // Decode cursor: "<ISO>|<threadId>"
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const [at, id] = cursor.split('|');
    if (at && id) { cursorAt = at; cursorId = id; }
  }

  try {
    // --- Step 1 ---------------------------------------------------------
    // Pull recent inbound (visibility=external, sender_kind=contact)
    // messages. We want the MOST RECENT inbound per thread; ordering by
    // created_at DESC then deduping in JS gives us that without needing
    // a window function.
    //
    // Pull a generous slice (limit*4) to give pagination + filtering some
    // room before falling back to the next page.
    let inboundQuery = supabaseAdmin
      .from('conversation_messages')
      .select('thread_id, sender_kind, body, channel, created_at')
      .eq('visibility', 'external')
      .eq('sender_kind', 'contact')
      .order('created_at', { ascending: false })
      .limit(Math.max(limit * 8, 200));

    if (cursorAt) inboundQuery = inboundQuery.lt('created_at', cursorAt);

    const { data: inboundRows, error: inboundErr } = await inboundQuery;
    if (inboundErr) throw new Error(`inbound query: ${inboundErr.message}`);

    const inbound = (inboundRows ?? []) as MessageMeta[];

    // Latest inbound per thread
    const latestInboundByThread = new Map<string, MessageMeta>();
    for (const m of inbound) {
      if (!latestInboundByThread.has(m.thread_id)) {
        latestInboundByThread.set(m.thread_id, m);
      }
    }
    let candidateThreadIds = Array.from(latestInboundByThread.keys());
    if (candidateThreadIds.length === 0) {
      return NextResponse.json({ threads: [], nextCursor: null });
    }

    // --- Step 2 ---------------------------------------------------------
    // For each candidate thread, ensure that NO outbound external reply
    // came in *after* the latest inbound — that's what makes a thread
    // "needs attention". Fetch latest external message per thread
    // regardless of sender, and keep only those whose latest external is
    // still the inbound row from step 1.
    const { data: latestExternalRows, error: latestExtErr } = await supabaseAdmin
      .from('conversation_messages')
      .select('thread_id, sender_kind, created_at')
      .eq('visibility', 'external')
      .in('thread_id', candidateThreadIds)
      .order('created_at', { ascending: false });
    if (latestExtErr) throw new Error(`latest-external query: ${latestExtErr.message}`);

    const latestExtByThread = new Map<string, { sender_kind: string; created_at: string }>();
    for (const r of (latestExternalRows ?? []) as Array<{ thread_id: string; sender_kind: string; created_at: string }>) {
      if (!latestExtByThread.has(r.thread_id)) {
        latestExtByThread.set(r.thread_id, { sender_kind: r.sender_kind, created_at: r.created_at });
      }
    }
    if (filter === 'open') {
      // Only threads where the bride is still the last to speak
      candidateThreadIds = candidateThreadIds.filter(id => {
        const last = latestExtByThread.get(id);
        return last && last.sender_kind === 'contact';
      });
    } else if (filter === 'closed') {
      // Only threads where venue/support has already replied
      candidateThreadIds = candidateThreadIds.filter(id => {
        const last = latestExtByThread.get(id);
        return last && last.sender_kind !== 'contact';
      });
    }
    // filter === 'all': keep all candidateThreadIds
    if (candidateThreadIds.length === 0) {
      return NextResponse.json({ threads: [], nextCursor: null });
    }

    // --- Step 3 ---------------------------------------------------------
    // Hydrate threads + venues + venue_customers in three batched queries.
    let threadQuery = supabaseAdmin
      .from('conversation_threads')
      .select('id, venue_id, venue_customer_id, subject, last_message_at, last_message_preview')
      .in('id', candidateThreadIds);
    if (venueId) threadQuery = threadQuery.eq('venue_id', venueId);

    const { data: threadRows, error: threadErr } = await threadQuery;
    if (threadErr) throw new Error(`threads query: ${threadErr.message}`);
    const threads = ((threadRows ?? []) as ThreadRow[]);

    if (threads.length === 0) {
      return NextResponse.json({ threads: [], nextCursor: null });
    }

    const venueIds        = Array.from(new Set(threads.map(t => t.venue_id)));
    const venueCustomerIds = Array.from(new Set(threads.map(t => t.venue_customer_id)));

    const [{ data: venueRows }, { data: vcRows }] = await Promise.all([
      supabaseAdmin
        .from('venues')
        .select('id, name')
        .in('id', venueIds),
      supabaseAdmin
        .from('venue_customers')
        .select('id, first_name, last_name, customer_email, phone')
        .in('id', venueCustomerIds),
    ]);

    const venueById = new Map<string, VenueRow>();
    for (const v of (venueRows ?? []) as VenueRow[]) venueById.set(v.id, v);
    const vcById = new Map<string, VenueCustomerRow>();
    for (const c of (vcRows ?? []) as VenueCustomerRow[]) vcById.set(c.id, c);

    // --- Step 4 ---------------------------------------------------------
    // Per-thread message counts. PostgREST exposes count via a HEAD-style
    // request; we do it batched. For an inbox we don't need exact counts,
    // so a single grouped query approximates well: pull message counts
    // via a select that groups in JS.
    const { data: countRows } = await supabaseAdmin
      .from('conversation_messages')
      .select('thread_id')
      .in('thread_id', candidateThreadIds);
    const countByThread = new Map<string, number>();
    for (const r of (countRows ?? []) as Array<{ thread_id: string }>) {
      countByThread.set(r.thread_id, (countByThread.get(r.thread_id) ?? 0) + 1);
    }

    // --- Step 5 ---------------------------------------------------------
    // Assemble rows + apply search filter + cursor pagination.
    let rows: BrideInboxRow[] = threads.map(t => {
      const v  = venueById.get(t.venue_id);
      const c  = vcById.get(t.venue_customer_id);
      const li = latestInboundByThread.get(t.id);
      return {
        thread_id:               t.id,
        venue_id:                t.venue_id,
        venue_name:              v?.name ?? '(deleted venue)',
        venue_customer_id:       t.venue_customer_id,
        contact_first_name:      c?.first_name ?? null,
        contact_last_name:       c?.last_name ?? null,
        contact_email:           c?.customer_email ?? null,
        contact_phone:           c?.phone ?? null,
        subject:                 (t.subject ?? '').trim() || 'Conversation',
        last_message_at:         t.last_message_at,
        last_message_preview:    t.last_message_preview,
        last_inbound_channel:    (li?.channel === 'sms' ? 'sms' : 'email'),
        last_inbound_body:       li?.body ?? '',
        last_inbound_created_at: li?.created_at ?? t.last_message_at,
        message_count:           countByThread.get(t.id) ?? 0,
      };
    });

    if (search) {
      rows = rows.filter(r =>
        r.venue_name.toLowerCase().includes(search) ||
        (r.contact_first_name ?? '').toLowerCase().includes(search) ||
        (r.contact_last_name  ?? '').toLowerCase().includes(search) ||
        (r.contact_email      ?? '').toLowerCase().includes(search) ||
        (r.last_message_preview ?? '').toLowerCase().includes(search) ||
        (r.last_inbound_body).toLowerCase().includes(search),
      );
    }

    // Cursor tiebreaker (created_at, thread_id) DESC
    if (cursorAt && cursorId) {
      rows = rows.filter(r =>
        r.last_inbound_created_at < cursorAt! ||
        (r.last_inbound_created_at === cursorAt && r.thread_id < cursorId!),
      );
    }

    rows.sort((a, b) => {
      if (a.last_inbound_created_at !== b.last_inbound_created_at) {
        return a.last_inbound_created_at < b.last_inbound_created_at ? 1 : -1;
      }
      return a.thread_id < b.thread_id ? 1 : -1;
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      nextCursor = `${last.last_inbound_created_at}|${last.thread_id}`;
      rows = rows.slice(0, limit);
    }

    return NextResponse.json({ threads: rows, nextCursor });
  } catch (err) {
    console.error('[bride-inbox] query failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load inbox' },
      { status: 500 },
    );
  }
}
