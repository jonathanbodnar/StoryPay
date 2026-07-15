/**
 * POST /api/integrations/ghl/verify
 *
 * Tests the venue's stored GHL credentials (API key + sub-account ID) with a
 * real 1-contact fetch — the exact call the contact sync makes — and returns
 * a granular diagnosis so the venue owner knows precisely what to fix:
 *
 *   - ok: true                → connection works, sync will succeed
 *   - reason: 'no_key'        → no API key saved yet
 *   - reason: 'no_location'   → no sub-account ID saved yet
 *   - reason: 'invalid_key'   → GHL 401: key revoked/expired/malformed
 *   - reason: 'wrong_location'→ GHL 403: key is valid but doesn't have access
 *                               to this sub-account ID (mismatched pair or
 *                               missing contacts scope on a PIT)
 *   - reason: 'error'         → anything else (network, GHL outage, etc.)
 */
import { NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { ghlRequest, classifyToken } from '@/lib/ghl';
import { ensureLocationToken } from '@/lib/ghl-auth';
import { bootstrapFallbackLocationToken } from '@/lib/ghl-contacts-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, ghl_location_id, ghl_access_token')
    .eq('id', venueId)
    .maybeSingle();

  const v = venue as { id: string; ghl_location_id: string | null; ghl_access_token: string | null } | null;
  if (!v) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  if (!v.ghl_location_id?.trim()) {
    return NextResponse.json({
      ok: false,
      reason: 'no_location',
      message: 'No sub-account ID saved yet. Paste it above and click Save.',
    });
  }
  if (!v.ghl_access_token?.trim() && !process.env.GHL_AGENCY_API_KEY && !process.env.GHL_PRIVATE_KEY) {
    return NextResponse.json({
      ok: false,
      reason: 'no_key',
      message: 'No API key saved yet. Paste it above and click Save.',
    });
  }

  const locationId = v.ghl_location_id.trim();

  let token: string;
  try {
    token = await ensureLocationToken({
      id: v.id,
      ghl_location_id: locationId,
      ghl_access_token: v.ghl_access_token,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      reason: 'invalid_key',
      message: err instanceof Error ? err.message : 'Could not obtain a working GHL token.',
    });
  }

  // Same call the contact sync makes — if this works, sync works.
  const testFetch = async (t: string) =>
    await ghlRequest(
      `/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`,
      t,
      { locationId },
    ) as { contacts?: unknown[]; meta?: { total?: number | null } };

  try {
    const result = await testFetch(token);
    return NextResponse.json({
      ok: true,
      tokenKind: classifyToken(token),
      totalContacts: typeof result.meta?.total === 'number' ? result.meta.total : null,
      message: 'Connected! Your API key and sub-account ID are working.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // 401/403 → the stored key can't reach this location. Before giving up,
    // try to heal via the agency-level integration (OAuth refresh → agency
    // key exchanged for a location key). If that works the venue is fixed
    // permanently — the healed key is persisted by the helper.
    if (/\b40[13]\b/.test(msg)) {
      try {
        const { data: refreshRow } = await supabaseAdmin
          .from('venues')
          .select('ghl_refresh_token')
          .eq('id', v.id)
          .maybeSingle();
        const healed = await bootstrapFallbackLocationToken(
          { id: v.id, ghl_refresh_token: (refreshRow as { ghl_refresh_token?: string | null } | null)?.ghl_refresh_token ?? null },
          locationId,
        );
        const result = await testFetch(healed);
        return NextResponse.json({
          ok: true,
          tokenKind: classifyToken(healed),
          totalContacts: typeof result.meta?.total === 'number' ? result.meta.total : null,
          message: 'Connected! Your pasted key didn\'t work, but we recovered access through the agency integration and saved a working key automatically.',
        });
      } catch (healErr) {
        console.warn('[ghl/verify] agency fallback also failed:', healErr instanceof Error ? healErr.message : healErr);
      }
    }

    if (/\b401\b/.test(msg)) {
      return NextResponse.json({
        ok: false,
        reason: 'invalid_key',
        message: 'GHL rejected the API key (401). The key has been revoked or is invalid — generate a new one in the sub-account and paste it above.',
      });
    }
    if (/\b403\b/.test(msg)) {
      return NextResponse.json({
        ok: false,
        reason: 'wrong_location',
        message:
          `GHL says this key does not have access to sub-account ${locationId} (403). ` +
          'The most common cause is a sub-account ID mismatch: copy the Location ID from Settings → Business Profile ' +
          'of the SAME sub-account where the key was created, and make sure there are no extra spaces. ' +
          'If you used a Private Integration token, it must also include the "View Contacts" and "Edit Contacts" scopes.',
      });
    }
    return NextResponse.json({
      ok: false,
      reason: 'error',
      message: `Connection test failed: ${msg.slice(0, 300)}`,
    });
  }
}
