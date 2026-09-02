/**
 * GET /api/admin/venue-concierge/search?q=...
 *
 * iMessage-style search across every Venue Concierge conversation. Matches on
 * message body, the venue name, the owner/team contact fields (name, email,
 * phone), the message author, and human-readable date/time strings of each
 * message. Multi-word queries are AND-matched (every token must appear
 * somewhere in a message's searchable text), so "magnolia sep 2" narrows to
 * Magnolia's messages on Sep 2.
 *
 * Returns matches grouped by venue with message previews for the concierge team
 * to jump back into any historical thread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySupportAccess } from '@/lib/support/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TZ = 'America/New_York';
const MAX_MESSAGES = 8000;
const MAX_VENUES = 60;
const MAX_MATCHES_PER_VENUE = 6;

interface MsgRow {
  id: string;
  venue_id: string;
  sender_kind: 'venue' | 'concierge';
  sender_support_user_id: string | null;
  sender_label: string | null;
  body: string;
  created_at: string;
}

/** Human-readable date/time variants so "Sep 2", "9/2/2026", "Wednesday",
 *  "2026-09-02", "4:36 PM" etc. all match the same message. */
function dateTimeHaystack(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts: string[] = [iso.slice(0, 10)];
  try {
    parts.push(d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }));
    parts.push(d.toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' }));
    parts.push(d.toLocaleDateString('en-US', { timeZone: TZ, month: '2-digit', day: '2-digit', year: 'numeric' }));
    parts.push(d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long' }));
    parts.push(d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }));
  } catch { /* locale not available — ISO is enough */ }
  return parts.join(' ');
}

export async function GET(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ results: [], query: '' });
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

  const { data: rows } = await supabaseAdmin
    .from('venue_concierge_messages')
    .select('id, venue_id, sender_kind, sender_support_user_id, sender_label, body, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES);
  const msgs = ((rows ?? []) as unknown) as MsgRow[];
  if (msgs.length === 0) return NextResponse.json({ results: [], query: q });

  const venueIds = Array.from(new Set(msgs.map((m) => m.venue_id)));
  const supportIds = Array.from(
    new Set(msgs.map((m) => m.sender_support_user_id).filter((x): x is string => !!x)),
  );

  // Per-venue contact haystack (name + owner/team email + phone).
  const [{ data: venues }, { data: members }, { data: people }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, email, notification_email, notification_phone, phone')
      .in('id', venueIds),
    supabaseAdmin
      .from('venue_team_members')
      .select('venue_id, name, email, phone')
      .in('venue_id', venueIds),
    supportIds.length > 0
      ? supabaseAdmin
          .from('support_team_members')
          .select('id, name, first_name, last_name')
          .in('id', supportIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null }> }),
  ]);

  const venueName: Record<string, string> = {};
  const venueHay: Record<string, string> = {};
  for (const v of (venues ?? []) as Array<{
    id: string; name: string | null; email: string | null; notification_email: string | null; notification_phone: string | null; phone: string | null;
  }>) {
    venueName[v.id] = v.name || 'Venue';
    venueHay[v.id] = [v.name, v.email, v.notification_email, v.notification_phone, v.phone]
      .filter(Boolean).join(' ').toLowerCase();
  }
  for (const m of (members ?? []) as Array<{ venue_id: string; name: string | null; email: string | null; phone: string | null }>) {
    const extra = [m.name, m.email, m.phone].filter(Boolean).join(' ').toLowerCase();
    venueHay[m.venue_id] = (venueHay[m.venue_id] ? venueHay[m.venue_id] + ' ' : '') + extra;
  }

  const authorName: Record<string, string> = {};
  for (const p of (people ?? []) as Array<{ id: string; name: string | null; first_name: string | null; last_name: string | null }>) {
    authorName[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name || 'Concierge';
  }

  // Filter messages: every token must appear in the message's searchable text.
  type Match = { id: string; body: string; createdAt: string; fromConcierge: boolean; authorName: string };
  const byVenue = new Map<string, { matches: Match[]; latestAt: string }>();

  for (const m of msgs) {
    const author = m.sender_kind === 'concierge'
      ? (m.sender_support_user_id ? (authorName[m.sender_support_user_id] || 'Concierge') : 'Concierge')
      : (m.sender_label || 'Venue');
    const haystack = [
      m.body,
      author,
      venueName[m.venue_id] || '',
      venueHay[m.venue_id] || '',
      dateTimeHaystack(m.created_at),
    ].join(' ').toLowerCase();

    if (!tokens.every((t) => haystack.includes(t))) continue;

    const entry = byVenue.get(m.venue_id) ?? { matches: [], latestAt: m.created_at };
    if (entry.matches.length < MAX_MATCHES_PER_VENUE) {
      entry.matches.push({
        id: m.id,
        body: m.body.length > 260 ? m.body.slice(0, 260) + '…' : m.body,
        createdAt: m.created_at,
        fromConcierge: m.sender_kind === 'concierge',
        authorName: author,
      });
    }
    byVenue.set(m.venue_id, entry);
  }

  const results = Array.from(byVenue.entries())
    .map(([venueId, group]) => ({
      venueId,
      venueName: venueName[venueId] || 'Venue',
      matches: group.matches,
      latestAt: group.matches[0]?.createdAt ?? group.latestAt,
    }))
    .sort((a, b) => +new Date(b.latestAt) - +new Date(a.latestAt))
    .slice(0, MAX_VENUES);

  return NextResponse.json({ results, query: q });
}
