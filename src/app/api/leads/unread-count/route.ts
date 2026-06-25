/**
 * GET /api/leads/unread-count?since=<ISO>
 *
 * Powers the red "new leads" badge on the Lead Inbox sidebar item (mirrors the
 * Conversations unread badge). Returns how many real leads have arrived since
 * the caller last acknowledged the inbox, plus the most recent lead timestamp
 * so the client can establish a baseline on first run (so we only ever alert on
 * genuinely NEW leads, never the entire backlog).
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PLACEHOLDER = '%@ghl-import.storyvenue.placeholder%';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sinceParam = new URL(req.url).searchParams.get('since');

  // Most recent real lead — used by the client to set its baseline on first run.
  const { data: latestRow } = await supabaseAdmin
    .from('leads')
    .select('created_at')
    .eq('venue_id', venueId)
    .not('email', 'ilike', PLACEHOLDER)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const latest = (latestRow as { created_at?: string } | null)?.created_at ?? null;

  let count = 0;
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (!Number.isNaN(since.getTime())) {
      const { count: c } = await supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', venueId)
        .gt('created_at', since.toISOString())
        .not('email', 'ilike', PLACEHOLDER);
      count = c ?? 0;
    }
  }

  return NextResponse.json({ count, latest });
}
