/**
 * POST /api/admin/backfill-ghl-dnd
 *
 * One-time retroactive sync: pulls current DND state from GHL for every
 * contact in every connected venue and writes it to venue_customers so the
 * SaaS checkboxes match what GHL already has.
 *
 * Requires super-admin auth.  Safe to call multiple times (idempotent).
 */
import { NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getGhlToken } from '@/lib/ghl';
import { syncGhlDndForVenue } from '@/lib/ghl-dnd-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Allow up to 5 minutes — large accounts may have thousands of contacts.
export const maxDuration = 300;

export async function POST(_req: Request) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows } = await supabaseAdmin
    .from('venues')
    .select('id, name, ghl_access_token, ghl_location_id, ghl_connected')
    .eq('ghl_connected', true)
    .not('ghl_access_token', 'is', null)
    .not('ghl_location_id', 'is', null);

  if (!rows || rows.length === 0) {
    return NextResponse.json({ message: 'No GHL-connected venues found.', venues: 0 });
  }

  const results: Array<{
    venueId: string;
    venueName: string;
    contactsScanned: number;
    contactsUpdated: number;
    errors: number;
  }> = [];

  for (const row of rows) {
    const token = getGhlToken(row as { ghl_access_token: string | null });
    if (!token || !row.ghl_location_id) continue;

    const result = await syncGhlDndForVenue(
      { id: row.id, name: row.name, locationId: row.ghl_location_id, token },
      { maxContacts: 10_000 }, // no practical cap for the backfill
    );

    results.push({
      venueId:  row.id,
      venueName: row.name,
      ...result,
    });

    console.log(`[dnd-backfill] ${row.name}: scanned=${result.contactsScanned} updated=${result.contactsUpdated} errors=${result.errors}`);
  }

  const totals = results.reduce(
    (acc, r) => {
      acc.totalScanned  += r.contactsScanned;
      acc.totalUpdated  += r.contactsUpdated;
      acc.totalErrors   += r.errors;
      return acc;
    },
    { totalScanned: 0, totalUpdated: 0, totalErrors: 0 },
  );

  return NextResponse.json({ ok: true, venues: results.length, ...totals, breakdown: results });
}
