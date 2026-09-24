/**
 * POST /api/venue/leadfinder/review/[importId]
 *
 * A human's verdict on a low-confidence LeadFinder™ arrival.
 *
 *   confirm → the record is right, so release the follow-up that was held at
 *             ingest: send the pricing guide (EMAIL ONLY — a phone number read
 *             out of a forwarded email is not TCPA consent) and enroll the lead
 *             in the same booking workflow every other lead gets.
 *   dismiss → a human says this is not a real inquiry. The lead is NOT deleted:
 *             this codebase protects user data. Only the arrival's review state
 *             changes, which removes it from the queue.
 *
 * Idempotent and venue-scoped: the update is claimed with
 * `review_state = 'needs_review'`, so confirming twice (or two people clicking
 * at once) can never send the guide twice.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { getSessionUser } from '@/lib/session';
import { sendBookingSystemGuide, onMarketingFormSubmitted } from '@/lib/marketing-email-worker';
import { ensureListingForm } from '@/lib/listing-lead-form';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ importId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { importId } = await context.params;
  if (!importId) return NextResponse.json({ error: 'Missing importId' }, { status: 400 });

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'confirm' && action !== 'dismiss') {
    return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'" }, { status: 400 });
  }

  const user = await getSessionUser();
  const reviewedBy = user?.memberId ?? null;

  // Claim the row in one conditional update. `review_state = 'needs_review'` is
  // what makes this idempotent: only the first caller transitions it and gets a
  // row back, so only that caller proceeds to contact the couple.
  const { data: updatedRow, error: upErr } = await supabaseAdmin
    .from('leadfinder_imports')
    .update({
      review_state: action === 'confirm' ? 'confirmed' : 'dismissed',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    })
    .eq('id', importId)
    .eq('venue_id', venueId)
    .eq('review_state', 'needs_review')
    .select('id, lead_id, review_state')
    .maybeSingle();

  if (upErr) {
    console.error('[leadfinder review POST] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (!updatedRow) {
    // No row was claimed: either it does not exist for this venue, or a human
    // already resolved it. Distinguish the two so a stale tab gets a clear 404
    // rather than a false "done".
    const { data: existing } = await supabaseAdmin
      .from('leadfinder_imports')
      .select('id, review_state')
      .eq('id', importId)
      .eq('venue_id', venueId)
      .maybeSingle();

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, alreadyResolved: true, reviewState: existing.review_state });
  }

  if (action === 'dismiss') {
    return NextResponse.json({ ok: true, reviewState: 'dismissed' });
  }

  const leadId = (updatedRow as { lead_id: string | null }).lead_id;
  if (leadId) {
    // Email-only, exactly like the automatic path: never the SMS leg.
    try {
      await sendBookingSystemGuide(venueId, leadId, { channels: 'email' });
    } catch (e) {
      console.error('[leadfinder review POST] guide send failed:', e);
    }

    // Parity with a normal creation: a confirmed lead gets the venue's booking
    // workflow (which was deliberately withheld at ingest). Enrollment dedupes,
    // so this cannot double-enroll.
    try {
      const formId = await ensureListingForm(venueId);
      if (formId) await onMarketingFormSubmitted(venueId, leadId, formId);
    } catch (e) {
      console.error('[leadfinder review POST] workflow trigger failed:', e);
    }
  }

  return NextResponse.json({ ok: true, reviewState: 'confirmed', leadId });
}
