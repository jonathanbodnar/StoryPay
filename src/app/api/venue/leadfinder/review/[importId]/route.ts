/**
 * POST /api/venue/leadfinder/review/[importId]
 *
 * A human's verdict on a low-confidence LeadFinder™ arrival.
 *
 *   confirm → the record is right (optionally after correcting the core
 *             fields in `fields`), so release the follow-up that was held at
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
import { sendBookingSystemGuide, onMarketingFormSubmitted, logNewLeadOpportunity } from '@/lib/marketing-email-worker';
import { ensureListingForm } from '@/lib/listing-lead-form';
import { normalizePhone } from '@/lib/leadfinder/extract';
import { syncLeadFinderAnswersToContact } from '@/lib/leadfinder/ingest';

/** The core fields a reviewer may correct before confirming. */
interface LeadEdits {
  name?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string;
  phone?: string | null;
  weddingDate?: string | null;
  guestCount?: number | null;
}

/**
 * Validate the reviewer's corrections. Only keys that are present are changed;
 * an empty string clears an optional field. Returns a message a person can act
 * on for anything that would not make a valid lead.
 */
function parseEdits(raw: Record<string, unknown>): { edits: LeadEdits } | { error: string } {
  const edits: LeadEdits = {};
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : null);

  if ('name' in raw) {
    const name = str(raw.name);
    if (!name) return { error: 'The lead needs a name.' };
    if (name.length > 120) return { error: 'That name is too long.' };
    const firstPerson = name.split(/\s+(?:&|and|\+)\s+/i)[0] ?? name;
    const parts = firstPerson.split(/\s+/).filter(Boolean);
    edits.name = name;
    edits.firstName = parts[0] ?? null;
    edits.lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
  }
  if ('email' in raw) {
    const email = (str(raw.email) ?? '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email address does not look right.' };
    edits.email = email;
  }
  if ('phone' in raw) {
    const phone = str(raw.phone);
    if (!phone) edits.phone = null;
    else {
      const normalized = normalizePhone(phone);
      if (!normalized) return { error: 'That phone number does not look right.' };
      edits.phone = normalized;
    }
  }
  if ('weddingDate' in raw) {
    const d = str(raw.weddingDate);
    if (!d) edits.weddingDate = null;
    else {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
      const valid = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === d;
      if (!valid) return { error: 'The wedding date should be a real date.' };
      edits.weddingDate = d;
    }
  }
  if ('guestCount' in raw) {
    const g = str(raw.guestCount);
    if (!g) edits.guestCount = null;
    else {
      const n = Number(g);
      if (!Number.isInteger(n) || n < 1 || n > 5000) return { error: 'The guest count should be a whole number between 1 and 5000.' };
      edits.guestCount = n;
    }
  }
  return { edits };
}

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

  let body: { action?: string; fields?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'confirm' && action !== 'dismiss') {
    return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'" }, { status: 400 });
  }

  // Validate corrections BEFORE claiming the row, so a bad value can never leave
  // an arrival marked confirmed with nothing sent.
  let edits: LeadEdits = {};
  if (action === 'confirm' && body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)) {
    const parsed = parseEdits(body.fields as Record<string, unknown>);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    edits = parsed.edits;
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
    return NextResponse.json({ error: 'Could not save your decision. Please try again.' }, { status: 500 });
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
  if (leadId && Object.keys(edits).length > 0) {
    // Apply the reviewer's corrections before anything is sent, so the guide
    // goes to the corrected address with the corrected name.
    const { data: before } = await supabaseAdmin
      .from('leads')
      .select('email, created_at')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (edits.name !== undefined) {
      patch.name = edits.name;
      patch.first_name = edits.firstName ?? null;
      patch.last_name = edits.lastName ?? null;
    }
    if (edits.email !== undefined) patch.email = edits.email;
    if (edits.phone !== undefined) patch.phone = edits.phone;
    if (edits.weddingDate !== undefined) patch.wedding_date = edits.weddingDate;
    if (edits.guestCount !== undefined) patch.guest_count = edits.guestCount;

    const { error: editErr } = await supabaseAdmin.from('leads').update(patch).eq('id', leadId).eq('venue_id', venueId);
    if (editErr) {
      console.error('[leadfinder review POST] applying corrections failed:', editErr.message);
    } else {
      const email = edits.email ?? ((before as { email?: string | null } | null)?.email ?? null);
      if (email) {
        await syncLeadFinderAnswersToContact(venueId, email, {
          firstName: edits.firstName ?? null,
          lastName: edits.lastName ?? null,
          phone: edits.phone ?? null,
          guestCount: edits.guestCount ?? null,
          weddingDate: edits.weddingDate ?? null,
          timeline: null,
          venueMatters: null,
        });
      }
      // Conversations are keyed by the contact's email: a corrected address is a
      // different contact, so give its thread the same opening marker.
      const previousEmail = ((before as { email?: string | null } | null)?.email ?? '').toLowerCase();
      if (edits.email && edits.email !== previousEmail) {
        await logNewLeadOpportunity(venueId, leadId, (before as { created_at?: string | null } | null)?.created_at ?? null);
      }
    }
  }

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
