import { NextResponse } from 'next/server';
import { requireVenueId } from '@/lib/auth-helpers';
import { syncGhlContactsForVenue } from '@/lib/ghl-contacts-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Manually trigger a GHL → StoryVenue contact pull for the signed-in venue.
 *
 * The settings page calls this when the user clicks "Import contacts now".
 * It runs synchronously — typical sub-accounts have ≤2 000 contacts which
 * complete well under Railway's 60-second request budget.  Larger accounts
 * just hit the per-page MAX_PAGES cap and get the rest on the next call
 * (the cron also runs hourly).
 */
export async function POST() {
  try {
    const venueId = await requireVenueId();
    const counts  = await syncGhlContactsForVenue(venueId);
    return NextResponse.json({ ok: true, counts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    const status  = message === 'Unauthorized' ? 401 : 500;
    console.error('[api ghl/sync-contacts]', message);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
