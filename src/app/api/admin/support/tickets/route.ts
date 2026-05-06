/**
 * GET /api/admin/support/tickets
 *
 * Lists support_threads (venue-owner ↔ StoryVenue support tickets) for the
 * super admin / agent inbox.
 *
 * Rewritten to use supabaseAdmin (PostgREST HTTP) instead of the raw
 * postgres-js client which fails on Supabase free-tier direct hosts
 * (IPv6-only, unreachable from Railway/Vercel).
 *
 * Query params:
 *   status?      open | pending | closed | all (default: open,pending)
 *   priority?    low | normal | high
 *   assigned_to? support_team_members.id | 'me' | 'unassigned'
 *   venue_id?
 *   search?      matches subject, last preview, or venue name
 *   cursor?      `${last_message_at}|${id}`
 *   limit?       default 50, max 100
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

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

const DEFAULT_STATUSES = ['open', 'pending'];

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url        = new URL(req.url);
  const statusRaw  = (url.searchParams.get('status') || '').trim();
  const priority   = (url.searchParams.get('priority') || '').trim();
  const assignedTo = (url.searchParams.get('assigned_to') || '').trim();
  const venueIdQ   = (url.searchParams.get('venue_id') || '').trim();
  const search     = (url.searchParams.get('search') || '').trim().toLowerCase();
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
    if (!statusRaw) return DEFAULT_STATUSES;
    if (statusRaw === 'all') return ['open', 'pending', 'closed'];
    const allowed = ['open', 'pending', 'closed'];
    return statusRaw.split(',').map(s => s.trim()).filter(s => allowed.includes(s));
  })();

  try {
    // ── 1. Fetch support_threads ─────────────────────────────────────────────
    let q = supabaseAdmin
      .from('support_threads')
      .select('id, venue_id, subject, status, priority, assigned_support_user_id, last_message_at, last_message_preview, opened_by_profile_id, opened_by_member_id, created_at')
      .in('status', statuses)
      .order('last_message_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (priority)  q = q.eq('priority', priority);
    if (venueIdQ)  q = q.eq('venue_id', venueIdQ);

    if (assignedTo === 'me' && agent?.sub) {
      q = q.eq('assigned_support_user_id', agent.sub);
    } else if (assignedTo === 'unassigned') {
      q = q.is('assigned_support_user_id', null);
    } else if (assignedTo) {
      q = q.eq('assigned_support_user_id', assignedTo);
    }

    if (cursorAt && cursorId) {
      q = q.lt('last_message_at', cursorAt);
    }

    const { data: threads, error: tErr } = await q;
    if (tErr) throw new Error(tErr.message);

    const rows = (threads ?? []) as Array<{
      id: string; venue_id: string; subject: string;
      status: string; priority: string;
      assigned_support_user_id: string | null;
      last_message_at: string; last_message_preview: string | null;
      opened_by_profile_id: string | null; opened_by_member_id: string | null;
      created_at: string;
    }>;

    if (rows.length === 0) {
      return NextResponse.json({ tickets: [], nextCursor: null });
    }

    // ── 2. Collect IDs for batch lookups ─────────────────────────────────────
    const venueIds       = Array.from(new Set(rows.map(r => r.venue_id)));
    const profileIds     = Array.from(new Set(rows.map(r => r.opened_by_profile_id).filter(Boolean))) as string[];
    const memberIds      = Array.from(new Set(rows.map(r => r.opened_by_member_id).filter(Boolean))) as string[];
    const supportUserIds = Array.from(new Set(rows.map(r => r.assigned_support_user_id).filter(Boolean))) as string[];
    const threadIds      = rows.map(r => r.id);

    // ── 3. Batch fetches ─────────────────────────────────────────────────────
    const [venueRes, profileRes, memberRes, supportRes, countRes] = await Promise.all([
      supabaseAdmin.from('venues').select('id, name, email').in('id', venueIds),
      profileIds.length
        ? supabaseAdmin.from('profiles').select('id, full_name').in('id', profileIds)
        : Promise.resolve({ data: [] }),
      memberIds.length
        ? supabaseAdmin.from('venue_team_members').select('id, first_name, last_name, email').in('id', memberIds)
        : Promise.resolve({ data: [] }),
      supportUserIds.length
        ? supabaseAdmin.from('support_team_members').select('id, name').in('id', supportUserIds)
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('support_thread_messages').select('support_thread_id').in('support_thread_id', threadIds),
    ]);

    // ── 4. Build lookup maps ──────────────────────────────────────────────────
    const venueMap   = Object.fromEntries((venueRes.data ?? []).map((v: { id: string; name: string | null; email: string | null }) => [v.id, v]));
    const profileMap = Object.fromEntries((profileRes.data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p]));
    const memberMap  = Object.fromEntries((memberRes.data ?? []).map((m: { id: string; first_name: string | null; last_name: string | null; email: string | null }) => [m.id, m]));
    const supportMap = Object.fromEntries((supportRes.data ?? []).map((s: { id: string; name: string }) => [s.id, s]));

    // Message counts per thread
    const countMap: Record<string, number> = {};
    for (const r of (countRes.data ?? []) as Array<{ support_thread_id: string }>) {
      countMap[r.support_thread_id] = (countMap[r.support_thread_id] ?? 0) + 1;
    }

    // ── 5. Hydrate rows ───────────────────────────────────────────────────────
    const hydrated: TicketListRow[] = rows.map(t => {
      const venue   = venueMap[t.venue_id] as { name: string | null; email: string | null } | undefined;
      const profile = t.opened_by_profile_id ? profileMap[t.opened_by_profile_id] as { full_name: string | null } | undefined : null;
      const member  = t.opened_by_member_id  ? memberMap[t.opened_by_member_id]   as { first_name: string | null; last_name: string | null; email: string | null } | undefined : null;
      const support = t.assigned_support_user_id ? supportMap[t.assigned_support_user_id] as { name: string } | undefined : null;

      const openerLabel = (() => {
        if (profile?.full_name) return profile.full_name;
        if (member) {
          const n = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
          return n || member.email || 'Team member';
        }
        return venue?.name || venue?.email || 'Venue owner';
      })();

      const openerEmail = member?.email ?? venue?.email ?? null;

      return {
        id:                       t.id,
        venue_id:                 t.venue_id,
        venue_name:               venue?.name ?? 'Unknown venue',
        subject:                  t.subject,
        status:                   t.status as TicketListRow['status'],
        priority:                 t.priority as TicketListRow['priority'],
        assigned_support_user_id: t.assigned_support_user_id,
        assigned_support_name:    support?.name ?? null,
        last_message_at:          t.last_message_at,
        last_message_preview:     t.last_message_preview,
        opener_label:             openerLabel,
        opener_email:             openerEmail,
        message_count:            countMap[t.id] ?? 0,
        created_at:               t.created_at,
      };
    });

    // ── 6. JS-side search filter ──────────────────────────────────────────────
    let filtered = hydrated;
    if (search) {
      filtered = hydrated.filter(r =>
        r.subject.toLowerCase().includes(search) ||
        (r.last_message_preview ?? '').toLowerCase().includes(search) ||
        r.venue_name.toLowerCase().includes(search) ||
        (r.opener_label ?? '').toLowerCase().includes(search),
      );
    }

    // ── 7. Cursor pagination ──────────────────────────────────────────────────
    // Apply cursor filter in JS (PostgREST can't do composite cursors cleanly)
    let paged = filtered;
    if (cursorAt && cursorId) {
      paged = filtered.filter(r =>
        r.last_message_at < cursorAt! ||
        (r.last_message_at === cursorAt && r.id < cursorId!),
      );
    }

    let nextCursor: string | null = null;
    if (paged.length > limit) {
      const last = paged[limit - 1];
      nextCursor = `${last.last_message_at}|${last.id}`;
      paged = paged.slice(0, limit);
    }

    return NextResponse.json({ tickets: paged, nextCursor });
  } catch (err) {
    console.error('[admin/support/tickets] query failed', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load tickets' },
      { status: 500 },
    );
  }
}
