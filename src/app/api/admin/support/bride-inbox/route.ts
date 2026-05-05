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
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { getDbAsync } from '@/lib/db';

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
  last_inbound_channel:    string;
  last_inbound_body:       string;
  last_inbound_created_at: string;
  message_count:           number;
}

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url      = new URL(req.url);
  const venueId  = (url.searchParams.get('venue_id') || '').trim();
  const search   = (url.searchParams.get('search') || '').trim();
  const cursor   = (url.searchParams.get('cursor') || '').trim();
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit    = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));

  // Decode cursor
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const [at, id] = cursor.split('|');
    if (at && id) {
      cursorAt = at;
      cursorId = id;
    }
  }

  const sql = await getDbAsync();
  try {
    const rows = (await sql`
      WITH latest_external AS (
        SELECT DISTINCT ON (m.thread_id)
               m.thread_id,
               m.sender_kind,
               m.body,
               m.channel,
               m.created_at
          FROM public.conversation_messages m
         WHERE m.visibility = 'external'
         ORDER BY m.thread_id, m.created_at DESC
      )
      SELECT t.id                          AS thread_id,
             t.venue_id,
             v.name                        AS venue_name,
             t.venue_customer_id,
             vc.first_name                 AS contact_first_name,
             vc.last_name                  AS contact_last_name,
             vc.customer_email             AS contact_email,
             vc.phone                      AS contact_phone,
             t.subject,
             t.last_message_at,
             t.last_message_preview,
             le.channel                    AS last_inbound_channel,
             le.body                       AS last_inbound_body,
             le.created_at                 AS last_inbound_created_at,
             (SELECT COUNT(*)::int FROM public.conversation_messages cm WHERE cm.thread_id = t.id) AS message_count
        FROM public.conversation_threads t
        JOIN latest_external le ON le.thread_id = t.id
        JOIN public.venues v    ON v.id = t.venue_id
        JOIN public.venue_customers vc ON vc.id = t.venue_customer_id
       WHERE le.sender_kind = 'contact'
         ${venueId ? sql`AND t.venue_id = ${venueId}::uuid` : sql``}
         ${search
           ? sql`AND (
               v.name                ILIKE ${'%' + search + '%'}
               OR vc.first_name      ILIKE ${'%' + search + '%'}
               OR vc.last_name       ILIKE ${'%' + search + '%'}
               OR vc.customer_email  ILIKE ${'%' + search + '%'}
               OR t.last_message_preview ILIKE ${'%' + search + '%'}
             )`
           : sql``}
         ${cursorAt && cursorId
           ? sql`AND (le.created_at, t.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)`
           : sql``}
       ORDER BY le.created_at DESC, t.id DESC
       LIMIT ${limit + 1}
    `) as unknown as BrideInboxRow[];

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      nextCursor = `${last.last_inbound_created_at}|${last.thread_id}`;
      rows.length = limit;
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
