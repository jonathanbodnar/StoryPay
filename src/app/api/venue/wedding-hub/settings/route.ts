import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  BRIDE_PORTAL_VISIBILITY_KEYS,
  getVenueBridePortalConfig,
  type BridePortalVisibilityKey,
} from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET — current Bride Portal add-on state + visibility settings for the venue. */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const config = await getVenueBridePortalConfig(venueId);
  return NextResponse.json(config);
}

/**
 * PATCH — update which wedding-data categories the venue shares with the bride.
 * Body: { visibility: Partial<Record<BridePortalVisibilityKey, boolean>> }.
 * Only the known keys are persisted; unknown keys are ignored.
 */
export async function PATCH(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { visibility?: Record<string, unknown> };
  try {
    body = (await request.json()) as { visibility?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const incoming = body.visibility ?? {};
  const next: Record<string, boolean> = {};
  for (const key of BRIDE_PORTAL_VISIBILITY_KEYS) {
    const raw = incoming[key as BridePortalVisibilityKey];
    // Persist an explicit boolean per known key; default to shared (true).
    next[key] = raw === undefined ? true : raw !== false;
  }

  const { error } = await supabaseAdmin
    .from('venues')
    .update({ wedding_hub_visibility: next })
    .eq('id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = await getVenueBridePortalConfig(venueId);
  return NextResponse.json({ ok: true, ...config });
}
