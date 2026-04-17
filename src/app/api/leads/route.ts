import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/leads?status=<status>&q=<text>
 *
 * Returns leads for the current logged-in venue, newest first. We also fetch
 * the venue once so the UI can show the listing slug/name alongside each lead.
 */
export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const q = searchParams.get('q')?.trim() ?? '';

  let query = supabaseAdmin
    .from('leads')
    .select(
      'id, venue_id, name, email, phone, wedding_date, guest_count, booking_timeline, message, notes, status, source, created_at, updated_at',
    )
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (status) query = query.eq('status', status);
  if (q) {
    const pat = `%${q}%`;
    query = query.or(`name.ilike.${pat},email.ilike.${pat},phone.ilike.${pat}`);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error('[GET /api/leads] failed:', error);
    return NextResponse.json({ error: `Failed to load leads: ${error.message}` }, { status: 500 });
  }

  // Pull the venue's slug/name once so each lead row can display it.
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('slug, name')
    .eq('id', venueId)
    .maybeSingle();

  const leads = (rows ?? []).map((l) => ({
    ...l,
    listing_slug: venue?.slug ?? null,
    listing_name: venue?.name ?? null,
  }));

  return NextResponse.json({ leads });
}
