import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { recordDuplicateCandidatesForNewLead } from '@/lib/lead-duplicates';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';
import { onMarketingFormSubmitted } from '@/lib/marketing-email-worker';
import { dispatchIntegrationEvent } from '@/lib/integration-events';
import { syncVenueCustomerFromLeadRow } from '@/lib/venue-customer-pipeline-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEAD_WEBHOOK_SECRET = process.env.LEAD_WEBHOOK_SECRET || '';
const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com';

function verifySignature(rawBody: string, signature: string): boolean {
  if (!LEAD_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto.createHmac('sha256', LEAD_WEBHOOK_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface LeadPayload {
  listing_slug?: string;
  venue_slug?: string;
  venue_id?: string;
  venue_listing_id?: string;
  // Support both combined name and split first/last
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  booking_timeline?: string;
  venue_matters?: string;
  message?: string;
  source?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referral_source?: string;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Ensure the venue has a "Listing Lead Form" in marketing_forms.
 * Returns the form id (creates one if absent).
 * Falls back to a name-based lookup when migration 068 (is_listing_form) is missing.
 */
async function ensureListingForm(venueId: string): Promise<string | null> {
  try {
    // Try the is_listing_form flag first (migration 068).
    const byFlag = await supabaseAdmin
      .from('marketing_forms')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_listing_form', true)
      .maybeSingle();

    if (!byFlag.error && byFlag.data) return byFlag.data.id as string;

    // If the column doesn't exist yet, fall back to matching by name.
    const colMissing = byFlag.error && /column.*is_listing_form/i.test(byFlag.error.message);
    if (colMissing || byFlag.error) {
      // Fallback: find or create by name only.
      const byName = await supabaseAdmin
        .from('marketing_forms')
        .select('id')
        .eq('venue_id', venueId)
        .ilike('name', 'Listing Lead Form')
        .maybeSingle();
      if (byName.data) return byName.data.id as string;
      // Create without is_listing_form (column absent).
      const created = await supabaseAdmin
        .from('marketing_forms')
        .insert({ venue_id: venueId, name: 'Listing Lead Form', published: true })
        .select('id')
        .single();
      return created.data ? (created.data.id as string) : null;
    }

    // No existing row — create it with the flag.
    const { data: created } = await supabaseAdmin
      .from('marketing_forms')
      .insert({ venue_id: venueId, name: 'Listing Lead Form', is_listing_form: true, published: true })
      .select('id')
      .single();

    return created ? (created.id as string) : null;
  } catch (e) {
    console.error('[public/leads] ensureListingForm failed:', e);
    return null;
  }
}

/**
 * Public inbound lead from the venue listing page.
 * Signed with HMAC-SHA256 using LEAD_WEBHOOK_SECRET.
 * Collects first/last name, phone, email, booking_timeline,
 * venue_matters, and an optional message.
 * On success: inserts lead → "New Lead" stage → fires form workflow trigger.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-storypay-signature') ?? '';

  if (!verifySignature(rawBody, signature)) {
    console.error('[public/leads] invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: LeadPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Resolve first / last name — accept split or combined
  const firstName = (payload.first_name ?? '').trim();
  const lastName  = (payload.last_name  ?? '').trim();
  const name = (payload.name ?? `${firstName} ${lastName}`).trim() || `${firstName} ${lastName}`.trim();

  const email = (payload.email ?? '').trim().toLowerCase();
  const phone = (payload.phone ?? '').trim();

  if (!firstName || !lastName || !email || !isEmail(email) || !phone) {
    return NextResponse.json(
      { error: 'first_name, last_name, phone, and valid email are required' },
      { status: 400 },
    );
  }

  const slug    = payload.listing_slug ?? payload.venue_slug;
  const venueId = payload.venue_id ?? payload.venue_listing_id;

  const venueSelectQuery = supabaseAdmin
    .from('venues')
    .select('id, slug, name, email, notification_email, email_notifications, is_demo, brand_website');

  const { data: venue, error: venueErr } = venueId
    ? await venueSelectQuery.eq('id', venueId).maybeSingle()
    : slug
      ? await venueSelectQuery.eq('slug', slug).maybeSingle()
      : { data: null, error: null };

  if (venueErr) {
    console.error('[public/leads] venue lookup failed:', venueErr);
    return NextResponse.json({ error: `Lookup failed: ${venueErr.message}` }, { status: 500 });
  }
  if (!venue) {
    console.warn('[public/leads] venue not found:', venueId ?? slug);
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) utm[k] = v.trim();
  }

  const insertPayload: Record<string, unknown> = {
    venue_id:               venue.id,
    first_name:             firstName,
    last_name:              lastName,
    name:                   name || `${firstName} ${lastName}`.trim(),
    email,
    phone:                  phone || null,
    booking_timeline:       payload.booking_timeline || null,
    venue_matters:          payload.venue_matters   || null,
    message:                payload.message         || null,
    source:                 payload.source          || 'directory',
    first_touch_utm:        Object.keys(utm).length ? utm : {},
    referral_source:        typeof payload.referral_source === 'string'
                              ? payload.referral_source.trim() || null
                              : null,
    // Submitting the public form is explicit consent to be contacted.
    // Force both flags on so existing DND/opt-out values on a previously
    // seen contact don't silently block the workflow steps.
    marketing_email_opt_in: true,
    sms_dnd:                false,
    // Public listing leads must always live in the sales pipeline.
    excluded_from_pipeline: false,
  };

  let insertResult = await supabaseAdmin
    .from('leads')
    .insert(insertPayload)
    .select('id, track_token, created_at, email, phone')
    .single();

  // Pre-051 schemas don't have excluded_from_pipeline. Strip and retry.
  if (
    insertResult.error &&
    /column .*excluded_from_pipeline/i.test(insertResult.error.message)
  ) {
    const { excluded_from_pipeline: _omit, ...rest } = insertPayload as
      Record<string, unknown> & { excluded_from_pipeline?: boolean };
    void _omit;
    insertResult = await supabaseAdmin
      .from('leads')
      .insert(rest)
      .select('id, track_token, created_at, email, phone')
      .single();
  }

  const { data: lead, error: insertErr } = insertResult;

  if (insertErr || !lead) {
    console.error('[public/leads] insert failed:', insertErr);
    return NextResponse.json(
      { error: `Failed to save lead: ${insertErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  const lr = lead as { id: string; created_at: string; email: string; phone: string | null };

  // Skip duplicate recording for demo venues — they exist to test resubmission.
  if (!(venue as { is_demo?: boolean }).is_demo) {
    void recordDuplicateCandidatesForNewLead(venue.id, lr.id, lr.email, lr.phone, lr.created_at);
  }

  // Fan out to Zapier / external integrations subscribed to lead.created
  void dispatchIntegrationEvent(venue.id, 'lead.created', {
    lead: {
      id: lr.id,
      first_name: firstName || '',
      last_name: lastName || '',
      full_name: [firstName, lastName].filter(Boolean).join(' ').trim() || lr.email,
      email: lr.email,
      phone: phone || '',
      source: 'directory',
      created_at: lr.created_at,
    },
  });

  // Upsert a venue_customers row so the lead is immediately visible on the
  // Contacts page and the contact profile inquiry fields are auto-populated.
  void (async () => {
    try {
      await supabaseAdmin
        .from('venue_customers')
        .upsert(
          {
            venue_id:       venue.id,
            customer_email: lr.email.toLowerCase(),
            first_name:     firstName || null,
            last_name:      lastName  || null,
            phone:          phone || null,
            updated_at:     new Date().toISOString(),
          },
          { onConflict: 'venue_id,customer_email' },
        );
    } catch (e) {
      console.warn('[public/leads] venue_customers upsert failed:', e);
    }
  })();

  // Place lead in the first stage (preferring "New Lead" when present) of the
  // default pipeline. We update the just-inserted lead, then also rescue any
  // earlier rows that share this email and are stuck (no pipeline_id/stage_id,
  // or excluded_from_pipeline) so prior test submissions become visible too.
  try {
    const defaultPipelineId = await ensureDefaultPipeline(venue.id);
    const { data: stages } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name')
      .eq('venue_id', venue.id)
      .eq('pipeline_id', defaultPipelineId)
      .order('position', { ascending: true });

    const targetStage =
      (stages ?? []).find((s) => s.name.toLowerCase().replace(/\s+/g, '') === 'newlead') ??
      (stages ?? [])[0] ??
      null;

    if (targetStage) {
      const stageStatus = legacyStatusForStageName(targetStage.name);
      const nowIso = new Date().toISOString();

      const baseUpdate: Record<string, unknown> = {
        pipeline_id:            defaultPipelineId,
        stage_id:               targetStage.id,
        status:                 stageStatus,
        // Explicitly include this lead in the pipeline. If the row was created
        // earlier as a contact-only record and is being re-submitted via the
        // listing form, it must appear on the Kanban now.
        excluded_from_pipeline: false,
        position:               0,
        updated_at:             nowIso,
      };

      // Update the new lead. If the schema is missing excluded_from_pipeline
      // (pre-051), drop the field and retry.
      let upd = await supabaseAdmin
        .from('leads')
        .update(baseUpdate)
        .eq('id', lr.id)
        .eq('venue_id', venue.id);
      if (upd.error && /column .*excluded_from_pipeline/i.test(upd.error.message)) {
        const { excluded_from_pipeline: _o, ...withoutFlag } = baseUpdate as
          Record<string, unknown> & { excluded_from_pipeline?: boolean };
        void _o;
        upd = await supabaseAdmin
          .from('leads')
          .update(withoutFlag)
          .eq('id', lr.id)
          .eq('venue_id', venue.id);
      }
      if (upd.error) {
        console.error('[public/leads] update pipeline on lead failed:', upd.error);
      }

      // Rescue earlier leads with the same email that ended up orphaned or
      // contact-only — they should also live on the Kanban for this venue.
      let stuck = await supabaseAdmin
        .from('leads')
        .update({
          pipeline_id:            defaultPipelineId,
          stage_id:               targetStage.id,
          status:                 stageStatus,
          excluded_from_pipeline: false,
          updated_at:             nowIso,
        })
        .eq('venue_id', venue.id)
        .ilike('email', lr.email)
        .neq('id', lr.id)
        .or(
          `excluded_from_pipeline.eq.true,stage_id.is.null,pipeline_id.is.null,pipeline_id.neq.${defaultPipelineId}`,
        );
      if (stuck.error && /column .*excluded_from_pipeline/i.test(stuck.error.message)) {
        await supabaseAdmin
          .from('leads')
          .update({
            pipeline_id: defaultPipelineId,
            stage_id:    targetStage.id,
            status:      stageStatus,
            updated_at:  nowIso,
          })
          .eq('venue_id', venue.id)
          .ilike('email', lr.email)
          .neq('id', lr.id);
      }

      // Sync the pipeline/stage onto the matching venue_customers row so
      // the lead appears immediately in the kanban and contact profile.
      void syncVenueCustomerFromLeadRow(venue.id, {
        email:       lr.email,
        pipeline_id: defaultPipelineId,
        stage_id:    targetStage.id,
      });
    }
  } catch (e) {
    console.error('[public/leads] attach default pipeline', e);
  }

  // Fire form-submitted workflow trigger then kick the cron so any delay steps
  // that were just scheduled get picked up automatically.
  try {
    const formId = await ensureListingForm(venue.id);
    if (formId) {
      console.log(`[public/leads] firing form trigger formId=${formId} venueId=${venue.id} leadId=${lr.id}`);
      await onMarketingFormSubmitted(venue.id, lr.id, formId);
      // Kick the cron after a short delay to advance any delay steps that were
      // just scheduled (fire-and-forget, never blocks the response).
      void (async () => {
        await new Promise((r) => setTimeout(r, 5_000));
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/$/, '');
        const secret = process.env.MARKETING_CRON_SECRET || process.env.CRON_SECRET || '';
        const url = `${appUrl}/api/cron/marketing-email${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;
        fetch(url).catch(() => {/* fire-and-forget */});
      })();
    } else {
      console.warn(`[public/leads] no listing form found for venue ${venue.id} — workflow not triggered`);
    }
  } catch (e) {
    console.error('[public/leads] workflow trigger', e);
  }

  // Owner notification email
  const notifyEnabled = venue.email_notifications !== false;
  if (notifyEnabled) {
    const notifyTo = venue.notification_email || venue.email || undefined;
    if (notifyTo) {
      const venueName    = venue.name ?? 'your venue';
      const listingLink  = venue.slug ? `${DIRECTORY_URL}/venue/${venue.slug}` : DIRECTORY_URL;
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1b1b1b;">
          <h2 style="margin:0 0 16px;">New lead for ${escapeHtml(venueName)}</h2>
          <p style="margin:0 0 16px;">You received a new inquiry from the StoryVenue directory.</p>
          <table style="width:100%;border-collapse:collapse;">
            ${row('Name',      `${firstName} ${lastName}`)}
            ${row('Email',     email)}
            ${row('Phone',     phone)}
            ${payload.booking_timeline ? row('Touring timeline', payload.booking_timeline) : ''}
            ${payload.venue_matters    ? row('Matters most',      payload.venue_matters)    : ''}
            ${payload.message          ? row('Message',           payload.message)           : ''}
          </table>
          <p style="margin:24px 0;">
            <a href="${escapeHtml(listingLink)}" style="color:#1b1b1b;">View listing</a> ·
            Manage in your dashboard.
          </p>
        </div>
      `;
      await sendEmail({
        to:      notifyTo,
        replyTo: email,
        subject: `New lead: ${firstName} ${lastName} — ${venueName}`,
        html,
      }).catch((e) => console.error('[public/leads] email error:', e));
    }
  }

  return NextResponse.json(
    {
      ok: true,
      lead_id: lead.id,
      track_token: (lead as { track_token?: string }).track_token ?? null,
      venue_slug: venue.slug ?? null,
      venue_website: (venue as { brand_website?: string | null }).brand_website ?? null,
    },
    { status: 201 },
  );
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#666;">${escapeHtml(label)}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
