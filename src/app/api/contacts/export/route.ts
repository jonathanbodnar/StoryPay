import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { mergeVenueContacts } from '@/lib/merge-venue-contacts';
import { csvRow } from '@/lib/csv';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_EXPORT = 20_000;

export async function GET(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('lunarpay_secret_key, ghl_connected, ghl_access_token, ghl_location_id')
    .eq('id', venueId)
    .single();

  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  if (!venue.ghl_connected && !venue.lunarpay_secret_key) {
    const { count } = await supabaseAdmin
      .from('venue_customers')
      .select('*', { count: 'exact', head: true })
      .eq('venue_id', venueId);
    if (!count) {
      return NextResponse.json({ error: 'No contact sources configured' }, { status: 400 });
    }
  }

  const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';
  const limit = Math.min(
    MAX_EXPORT,
    parseInt(request.nextUrl.searchParams.get('limit') || String(MAX_EXPORT), 10) || MAX_EXPORT,
  );

  const { data: rows } = await mergeVenueContacts(venueId, { search, page: 1, limit });

  const header = csvRow(['email', 'first_name', 'last_name', 'phone', 'source', 'external_id']);
  const lines = [header];
  for (const c of rows) {
    lines.push(
      csvRow([
        c.email,
        c.firstName,
        c.lastName,
        c.phone,
        c.source,
        String(c.id),
      ]),
    );
  }

  const csv = lines.join('\r\n') + '\r\n';
  const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
