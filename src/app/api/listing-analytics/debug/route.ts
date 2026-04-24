/**
 * Debug endpoint: verify listing_events table exists and show recent rows.
 * GET /api/listing-analytics/debug
 * Only accessible when authenticated as a venue (venue_id cookie required).
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Not authenticated — must be logged into venue dashboard' }, { status: 401 });

  // 1. Check table exists
  const { error: tableErr } = await supabaseAdmin
    .from('listing_events')
    .select('id')
    .limit(1);

  if (tableErr && /listing_events/i.test(tableErr.message)) {
    return NextResponse.json({
      table_exists: false,
      error: 'listing_events table not found — run migration 056_listing_analytics.sql in Supabase SQL editor',
      venue_id: venueId,
    }, { status: 200 });
  }

  // 2. Total events for this venue
  const { count: totalCount } = await supabaseAdmin
    .from('listing_events')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId);

  // 3. Last 20 events (any age)
  const { data: recent, error: recentErr } = await supabaseAdmin
    .from('listing_events')
    .select('id, session_id, event_type, device_type, country, city, created_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(20);

  // 4. Events in last 5 minutes
  const since5m = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { count: last5mCount } = await supabaseAdmin
    .from('listing_events')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .gte('created_at', since5m);

  // 5. Events in last 30 minutes
  const since30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { count: last30mCount } = await supabaseAdmin
    .from('listing_events')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .gte('created_at', since30m);

  return NextResponse.json({
    table_exists: true,
    venue_id: venueId,
    total_events: totalCount ?? 0,
    last_5m: last5mCount ?? 0,
    last_30m: last30mCount ?? 0,
    recent_events: recent ?? [],
    fetch_error: recentErr?.message ?? null,
    server_time: new Date().toISOString(),
  });
}
