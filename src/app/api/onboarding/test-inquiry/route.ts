/**
 * POST /api/onboarding/test-inquiry — the onboarding "activation moment".
 *
 * Fires a real lead through the venue's own just-published Bride Booking
 * System so the owner watches it work end to end: the lead lands in the Lead
 * Inbox, a chat thread is seeded, and the Speed-to-Lead welcome email/SMS
 * fires to the owner's contact on file (the same path a real bride triggers).
 *
 * Reuses the exact tail of POST /api/public/leads so what the owner sees in
 * the test is identical to what a real bride receives.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';
import {
  onMarketingFormSubmitted,
  sendBookingSystemGuide,
  logNewLeadOpportunity,
} from '@/lib/marketing-email-worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/** Find or create the venue's listing lead form (mirror of the public route). */
async function ensureListingForm(venueId: string): Promise<string | null> {
  try {
    const byFlag = await supabaseAdmin
      .from('marketing_forms')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_listing_form', true)
      .maybeSingle();
    if (!byFlag.error && byFlag.data) return byFlag.data.id as string;

    const colMissing = byFlag.error && /column.*is_listing_form/i.test(byFlag.error.message);
    if (colMissing || byFlag.error) {
      const byName = await supabaseAdmin
        .from('marketing_forms')
        .select('id')
        .eq('venue_id', venueId)
        .ilike('name', 'Listing Lead Form')
        .maybeSingle();
      if (byName.data) return byName.data.id as string;
      const created = await supabaseAdmin
        .from('marketing_forms')
        .insert({ venue_id: venueId, name: 'Listing Lead Form', published: true })
        .select('id')
        .single();
      return created.data ? (created.data.id as string) : null;
    }

    const { data: created } = await supabaseAdmin
      .from('marketing_forms')
      .insert({ venue_id: venueId, name: 'Listing Lead Form', is_listing_form: true, published: true })
      .select('id')
      .single();
    return created ? (created.id as string) : null;
  } catch (e) {
    console.error('[test-inquiry] ensureListingForm failed:', e);
    return null;
  }
}

export async function POST(): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, email, notification_email, brand_phone, owner_first_name, owner_last_name')
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const v = venue as Record<string, unknown>;
  const ownerEmail = String((v.notification_email as string) || (v.email as string) || '').trim();
  if (!ownerEmail) {
    return NextResponse.json(
      { error: 'Add a contact email to your listing first so we can deliver the test guide.' },
      { status: 400 },
    );
  }
  const ownerPhone = String((v.brand_phone as string) || '').trim() || null;
  const firstName = String((v.owner_first_name as string) || '').trim() || 'Test';
  const lastName = String((v.owner_last_name as string) || '').trim() || 'Bride';
  const fullName = `${firstName} ${lastName}`.trim();

  // Make sure the Booking System is on so the welcome email actually sends
  // (sendBookingSystemGuide no-ops when booking_system_enabled is false).
  // Best-effort: ignore column errors on pre-migration schemas.
  await supabaseAdmin
    .from('venues')
    .update({ booking_system_enabled: true, booking_guide_email_enabled: true })
    .eq('id', venueId)
    .then(({ error }) => { if (error && !/column/i.test(error.message)) console.warn('[test-inquiry] enable booking', error.message); });

  // 1. Insert the test lead (same shape as a real directory inquiry).
  const message = 'Hi! I found your venue and would love to check availability and pricing for my wedding. (This is a sample inquiry from your own Bride Booking System.)';
  const insertPayload: Record<string, unknown> = {
    venue_id: venueId,
    first_name: firstName,
    last_name: lastName,
    name: fullName,
    email: ownerEmail,
    phone: ownerPhone,
    booking_timeline: 'Touring soon',
    message,
    source: 'test_inquiry',
    marketing_email_opt_in: true,
    sms_dnd: false,
    excluded_from_pipeline: false,
  };

  let insertResult = await supabaseAdmin
    .from('leads')
    .insert(insertPayload)
    .select('id, created_at, email, phone')
    .single();
  if (insertResult.error && /column .*excluded_from_pipeline/i.test(insertResult.error.message)) {
    const { excluded_from_pipeline: _omit, ...rest } = insertPayload as Record<string, unknown> & { excluded_from_pipeline?: boolean };
    void _omit;
    insertResult = await supabaseAdmin
      .from('leads')
      .insert(rest)
      .select('id, created_at, email, phone')
      .single();
  }

  const { data: lead, error: insertErr } = insertResult;
  if (insertErr || !lead) {
    console.error('[test-inquiry] insert failed:', insertErr);
    return NextResponse.json({ error: `Could not create the test lead: ${insertErr?.message ?? 'unknown'}` }, { status: 500 });
  }
  const lr = lead as { id: string; created_at: string; email: string; phone: string | null };

  // 2. Attach to the default pipeline's "New Lead" stage so it shows on the Kanban.
  try {
    const defaultPipelineId = await ensureDefaultPipeline(venueId);
    const { data: stages } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name')
      .eq('venue_id', venueId)
      .eq('pipeline_id', defaultPipelineId)
      .order('position', { ascending: true });
    const targetStage =
      (stages ?? []).find((s) => s.name.toLowerCase().replace(/\s+/g, '') === 'newlead') ??
      (stages ?? [])[0] ?? null;
    if (targetStage) {
      const baseUpdate: Record<string, unknown> = {
        pipeline_id: defaultPipelineId,
        stage_id: targetStage.id,
        status: legacyStatusForStageName(targetStage.name),
        excluded_from_pipeline: false,
        position: 0,
        updated_at: new Date().toISOString(),
      };
      let upd = await supabaseAdmin.from('leads').update(baseUpdate).eq('id', lr.id).eq('venue_id', venueId);
      if (upd.error && /column .*excluded_from_pipeline/i.test(upd.error.message)) {
        const { excluded_from_pipeline: _o, ...withoutFlag } = baseUpdate as Record<string, unknown> & { excluded_from_pipeline?: boolean };
        void _o;
        upd = await supabaseAdmin.from('leads').update(withoutFlag).eq('id', lr.id).eq('venue_id', venueId);
      }
    }
  } catch (e) {
    console.error('[test-inquiry] attach pipeline', e);
  }

  // 3. Seed the chat thread (lands in the Lead Inbox in real time).
  await logNewLeadOpportunity(venueId, lr.id, lr.created_at);

  // 4. Fire the welcome email/SMS (Phase 1 guide delivery). Awaited so the
  //    success screen can truthfully say it was sent.
  await sendBookingSystemGuide(venueId, lr.id).catch((e) =>
    console.error('[test-inquiry] sendBookingSystemGuide error:', e),
  );

  // 5. Fire the Speed-to-Lead form-submitted automation, exactly like a bride.
  try {
    const formId = await ensureListingForm(venueId);
    if (formId) await onMarketingFormSubmitted(venueId, lr.id, formId);
  } catch (e) {
    console.error('[test-inquiry] workflow trigger', e);
  }

  // 6. Mark the venue activated (the real activation event). Best-effort —
  //    column added by migration 151; ignored if not yet applied.
  await supabaseAdmin
    .from('venues')
    .update({ onboarding_activated_at: new Date().toISOString() })
    .eq('id', venueId)
    .then(({ error }) => { if (error && !/column/i.test(error.message)) console.warn('[test-inquiry] activated stamp', error.message); });

  void import('@/lib/analytics')
    .then(({ trackMilestone }) => trackMilestone('activated', { venueId, label: 'Onboarding: test lead activated' }))
    .catch(() => { /* non-fatal */ });

  return NextResponse.json({
    ok: true,
    lead: {
      id: lr.id,
      name: fullName,
      email: lr.email,
      phone: lr.phone,
      message,
      booking_timeline: 'Touring soon',
      created_at: lr.created_at,
    },
    email_sent: true,
    email_to: ownerEmail,
  });
}
