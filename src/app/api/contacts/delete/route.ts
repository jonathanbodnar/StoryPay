import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { deleteGhlContact, getGhlToken, refreshAccessToken } from '@/lib/ghl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeletePayload {
  /** Raw id from the contacts list — could be a venue_customers UUID, a GHL contact ID, or `lp_<lunarpayId>`. */
  id?: string;
  /** Contact email (used as a fallback to resolve venue_customers when id is from GHL/LP). */
  email?: string;
  /** Source hint from the contacts list: 'ghl' | 'lunarpay' | 'storypay'. */
  source?: 'ghl' | 'lunarpay' | 'storypay';
}

/**
 * Unified contact deletion. Handles the messy reality that contacts on the
 * dashboard can come from three sources (GHL, LunarPay, StoryVenue) and
 * sometimes don't have a matching `venue_customers` row at all.
 *
 * Steps:
 *   1. Try to resolve a `venue_customers` row (by UUID, then by email).
 *   2. If found:
 *      - Delete from `venue_customers` (CASCADE clears notes/tasks/threads).
 *      - Delete matching `leads` rows.
 *      - Remember `ghl_contact_id` for the GHL-side cleanup.
 *   3. Delete from GHL (using either the stored `ghl_contact_id` or the raw
 *      id from the request when source is 'ghl'). This prevents the contact
 *      from re-syncing back next time the dashboard refreshes.
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: DeletePayload;
  try { body = (await request.json()) as DeletePayload; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const id = (body.id ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const source = body.source;
  if (!id && !email) {
    return NextResponse.json({ error: 'id or email required' }, { status: 400 });
  }

  // ── 1. Resolve venue_customers row ─────────────────────────────────────────
  type VcRow = {
    id: string;
    ghl_contact_id: string | null;
    is_protected: boolean | null;
    customer_email: string | null;
  };
  let vcRow: VcRow | null = null;

  if (id && UUID_RE.test(id)) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id, ghl_contact_id, is_protected, customer_email')
      .eq('id', id)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (data) vcRow = data as unknown as VcRow;
  }

  if (!vcRow && email) {
    const { data } = await supabaseAdmin
      .from('venue_customers')
      .select('id, ghl_contact_id, is_protected, customer_email')
      .eq('venue_id', venueId)
      .eq('customer_email', email)
      .maybeSingle();
    if (data) vcRow = data as unknown as VcRow;
  }

  // ── 2. Block deletion of protected demo contacts ───────────────────────────
  if (vcRow?.is_protected) {
    return NextResponse.json(
      { error: 'This is a protected demo contact and cannot be deleted.' },
      { status: 403 },
    );
  }

  // ── 3. Determine which GHL contact id (if any) to delete remotely ──────────
  // Prefer the id stored on venue_customers.ghl_contact_id; fall back to the
  // raw request id when the contact was from the GHL source.
  const ghlContactId =
    vcRow?.ghl_contact_id ||
    (source === 'ghl' && id && !UUID_RE.test(id) ? id : null);

  // ── 4. Delete from venue_customers (cascade) and leads ─────────────────────
  if (vcRow) {
    const { error: delErr } = await supabaseAdmin
      .from('venue_customers')
      .delete()
      .eq('id', vcRow.id)
      .eq('venue_id', venueId);
    if (delErr) {
      console.error('[contacts/delete] venue_customers delete:', delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (vcRow.customer_email) {
      await supabaseAdmin
        .from('leads')
        .delete()
        .eq('venue_id', venueId)
        .ilike('email', vcRow.customer_email);
    }
  } else if (email) {
    // No venue_customers row but a lead might exist for this email.
    await supabaseAdmin
      .from('leads')
      .delete()
      .eq('venue_id', venueId)
      .ilike('email', email);
  }

  // ── 5. Delete from GHL so it doesn't resync back ───────────────────────────
  let ghlDeleted = false;
  if (ghlContactId) {
    const { data: venue } = await supabaseAdmin
      .from('venues')
      .select('ghl_connected, ghl_access_token, ghl_refresh_token, ghl_location_id')
      .eq('id', venueId)
      .maybeSingle();

    if (venue?.ghl_location_id) {
      // Try to refresh the per-venue token first if available; fall back to
      // whatever getGhlToken resolves (per-venue OAuth or agency key).
      let token: string | null = (venue.ghl_access_token as string | null) ?? null;
      if (venue.ghl_refresh_token) {
        try {
          const refreshed = await refreshAccessToken(venue.ghl_refresh_token as string);
          if (refreshed.access_token) {
            token = refreshed.access_token;
            await supabaseAdmin.from('venues').update({
              ghl_access_token: refreshed.access_token,
              ghl_refresh_token: refreshed.refresh_token || venue.ghl_refresh_token,
            }).eq('id', venueId);
          }
        } catch {/* fall through to existing token / agency key */}
      }
      if (!token) token = getGhlToken({ ghl_access_token: null });

      if (token) {
        ghlDeleted = await deleteGhlContact(token, venue.ghl_location_id as string, ghlContactId);
        if (!ghlDeleted) {
          console.warn(`[contacts/delete] GHL delete returned non-OK for contact ${ghlContactId}`);
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    venue_customer_deleted: !!vcRow,
    ghl_deleted: ghlDeleted,
  });
}
