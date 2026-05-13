import { NextResponse } from 'next/server';
import { requireVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { syncGhlContactsForVenue } from '@/lib/ghl-contacts-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Kick off a GHL → StoryVenue contact pull for the signed-in venue.
 *
 * Returns immediately. The sync runs in the background and persists
 * progress to `venues.ghl_sync_progress` after each page so the UI can
 * render a progress bar by polling GET on this route.
 *
 * If the migration adding ghl_sync_progress hasn't been applied yet, the
 * progress writes silently no-op and the UI falls back to a generic
 * "syncing..." spinner.
 */
export async function POST() {
  let venueId: string;
  try {
    venueId = await requireVenueId();
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Don't await — the sync detaches and runs server-side after the response
  // is sent. Errors are written to ghl_sync_progress so the UI can surface
  // them on the next poll.
  void syncGhlContactsForVenue(venueId).catch(async (err) => {
    const message = err instanceof Error ? err.message : 'Sync failed';
    console.error('[bg ghl/sync-contacts]', venueId, message);
    try {
      await supabaseAdmin
        .from('venues')
        .update({
          ghl_sync_progress: {
            status: 'failed',
            error: message,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          },
        })
        .eq('id', venueId);
    } catch {
      // Column may not exist — non-fatal.
    }
  });

  // Optimistically mark the venue as syncing for immediate UI feedback even
  // before the first page completes.
  try {
    await supabaseAdmin
      .from('venues')
      .update({
        ghl_sync_progress: {
          status: 'running',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          fetched: 0,
          total: null,
          page: 0,
        },
      })
      .eq('id', venueId);
  } catch {
    // Column may not exist — non-fatal.
  }

  return NextResponse.json({ ok: true, status: 'started' });
}

/**
 * Poll endpoint: returns the current ghl_sync_progress for the signed-in
 * venue. The UI hits this every couple of seconds while a sync is running.
 */
export async function GET() {
  let venueId: string;
  try {
    venueId = await requireVenueId();
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data } = await supabaseAdmin
    .from('venues')
    .select('ghl_sync_progress, ghl_contacts_synced_at')
    .eq('id', venueId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    progress: (data as { ghl_sync_progress?: unknown } | null)?.ghl_sync_progress ?? null,
    last_synced_at: (data as { ghl_contacts_synced_at?: string | null } | null)?.ghl_contacts_synced_at ?? null,
  });
}
