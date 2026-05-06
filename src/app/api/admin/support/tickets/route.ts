/**
 * GET /api/admin/support/tickets
 *
 * Lists support_threads (venue-owner ↔ StoryVenue support tickets) for the
 * super admin / agent inbox.
 *
 * Query params:
 *   status?      open | pending | closed | all (default: open,pending)
 *   priority?    low | normal | high
 *   assigned_to? support_team_members.id  (use 'me' to filter to current agent)
 *                                          or 'unassigned'
 *   venue_id?
 *   search?      matches subject, last preview, or venue name
 *   cursor?      `${last_message_at}|${id}`
 *   limit?       default 50, max 100
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { getDbAsync } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TicketListRow {
  id:                       string;
  venue_id:                 string;
  venue_name:               string;
  subject:                  string;
  status:                   'open' | 'pending' | 'closed';
  priority:                 'low' | 'normal' | 'high';
  assigned_support_user_id: string | null;
  assigned_support_name:    string | null;
  last_message_at:          string;
  last_message_preview:     string | null;
  opener_label:             string;
  opener_email:             string | null;
  message_count:            number;
  created_at:               string;
}

const DEFAULT_STATUSES = ['open', 'pending'] as const;

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url        = new URL(req.url);
  const statusRaw  = (url.searchParams.get('status') || '').trim();
  const priority   = (url.searchParams.get('priority') || '').trim();
  const assignedTo = (url.searchParams.get('assigned_to') || '').trim();
  const venueId    = (url.searchParams.get('venue_id') || '').trim();
  const search     = (url.searchParams.get('search') || '').trim();
  const cursor     = (url.searchParams.get('cursor') || '').trim();
  const rawLimit   = Number(url.searchParams.get('limit'));
  const limit      = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 50, 100));

  // Decode cursor
  let cursorAt: string | null = null;
  let cursorId: string | null = null;
  if (cursor) {
    const [at, id] = cursor.split('|');
    if (at && id) { cursorAt = at; cursorId = id; }
  }

  // Resolve status filter
  const statuses: string[] = (() => {
    if (!statusRaw) return [...DEFAULT_STATUSES];
    if (statusRaw === 'all') return ['open', 'pending', 'closed'];
    const allowed = ['open', 'pending', 'closed'];
    return statusRaw.split(',').map(s => s.trim()).filter(s => allowed.includes(s));
  })();

  const sql = await getDbAsync();
  try {
    const assignedFragment =
      assignedTo === 'me' && agent?.sub
        ? sql`AND t.assigned_support_user_id = ${agent.sub}::uuid`
      : assignedTo === 'unassigned'
        ? sql`AND t.assigned_support_user_id IS NULL`
      : assignedTo
        ? sql`AND t.assigned_support_user_id = ${assignedTo}::uuid`
      : sql``;

    const rows = (await sql`
      SELECT
        t.id,
        t.venue_id,
        v.name AS venue_name,
        t.subject,
        t.status,
        t.priority,
        t.assigned_support_user_id,
        stm.name AS assigned_support_name,
        t.last_message_at,
        t.last_message_preview,
        COALESCE(p.full_name, vtm_label.label, v.name, v.email, 'Venue owner') AS opener_label,
        COALESCE(vtm_label.email, v.email) AS opener_email,
        (SELECT COUNT(*)::int FROM public.support_thread_messages m WHERE m.support_thread_id = t.id) AS message_count,
        t.created_at
      FROM public.support_threads t
      JOIN public.venues v ON v.id = t.venue_id
      LEFT JOIN public.support_team_members stm ON stm.id = t.assigned_support_user_id
      LEFT JOIN public.profiles p ON p.id = t.opened_by_profile_id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(NULLIF(TRIM(BOTH FROM CONCAT_WS(' ', vtm.first_name, vtm.last_name)), ''), vtm.email) AS label,
          vtm.email AS email
        FROM public.venue_team_members vtm
        WHERE vtm.id = t.opened_by_member_id
      ) vtm_label ON TRUE
      WHERE t.status = ANY(${statuses}::text[])
        ${priority ? sql`AND t.priority = ${priority}` : sql``}
        ${venueId ? sql`AND t.venue_id = ${venueId}::uuid` : sql``}
        ${assignedFragment}
        ${search
          ? sql`AND (
              t.subject              ILIKE ${'%' + search + '%'}
              OR t.last_message_preview ILIKE ${'%' + search + '%'}
              OR v.name              ILIKE ${'%' + search + '%'}
            )`
          : sql``}
        ${cursorAt && cursorId
          ? sql`AND (t.last_message_at, t.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)`
          : sql``}
      ORDER BY
        CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        t.last_message_at DESC,
        t.id DESC
      LIMIT ${limit + 1}
    `) as unknown as TicketListRow[];

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      nextCursor = `${last.last_message_at}|${last.id}`;
      rows.length = limit;
    }

    return NextResponse.json({ tickets: rows, nextCursor });
  } catch (err) {
    console.error('[admin/support/tickets] query failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load tickets' },
      { status: 500 },
    );
  }
}
