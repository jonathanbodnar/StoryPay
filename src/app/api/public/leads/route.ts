import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { recordDuplicateCandidatesForNewLead } from '@/lib/lead-duplicates';
import { ensureDefaultPipeline, legacyStatusForStageName } from '@/lib/pipelines';
import { onMarketingFormSubmitted } from '@/lib/marketing-email-worker';

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
 */
async function ensureListingForm(venueId: string): Promise<string | null> {
  try {
    const { data: existing } = await supabaseAdmin
      .from('marketing_forms')
      .select('id')
      .eq('venue_id', venueId)
      .eq('is_listing_form', true)
      .maybeSingle();

    if (existing) return existing.id as string;

    const { data: created } = await supabaseAdmin
      .from('marketing_forms')
      .insert({
        venue_id: venueId,
        name: 'Listing Lead Form',
        is_listing_form: true,
        published: true,
      })
      .select('id')
      .single();

    return created ? (created.id as string) : null;
  } catch {
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

  const venueQuery = supabaseAdmin
    .from('venues')
    .select('id, slug, name, email, notification_email, email_notifications');

  const { data: venue, error: venueErr } = venueId
    ? await venueQuery.eq('id', venueId).maybeSingle()
    : slug
      ? await venueQuery.eq('slug', slug).maybeSingle()
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

  const { data: lead, error: insertErr } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id:         venue.id,
      first_name:       firstName,
      last_name:        lastName,
      name:             name || `${firstName} ${lastName}`.trim(),
      email,
      phone:            phone || null,
      booking_timeline: payload.booking_timeline || null,
      venue_matters:    payload.venue_matters   || null,
      message:          payload.message         || null,
      source:           payload.source          || 'directory',
      first_touch_utm:  Object.keys(utm).length ? utm : {},
      referral_source:  typeof payload.referral_source === 'string'
                          ? payload.referral_source.trim() || null
                          : null,
    })
    .select('id, track_token, created_at, email, phone')
    .single();

  if (insertErr || !lead) {
    console.error('[public/leads] insert failed:', insertErr);
    return NextResponse.json(
      { error: `Failed to save lead: ${insertErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  const lr = lead as { id: string; created_at: string; email: string; phone: string | null };

  void recordDuplicateCandidatesForNewLead(venue.id, lr.id, lr.email, lr.phone, lr.created_at);

  // Place lead in "New Lead" stage of the default pipeline
  try {
    const defaultPipelineId = await ensureDefaultPipeline(venue.id);
    const { data: stages } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('id, name')
      .eq('venue_id', venue.id)
      .eq('pipeline_id', defaultPipelineId)
      .order('position', { ascending: true });

    // Prefer a stage named "New Lead"; fall back to the first stage
    const targetStage =
      (stages ?? []).find((s) => s.name.toLowerCase().replace(/\s+/g, '') === 'newlead') ??
      (stages ?? [])[0] ??
      null;

    if (targetStage) {
      await supabaseAdmin
        .from('leads')
        .update({
          pipeline_id: defaultPipelineId,
          stage_id:    targetStage.id,
          status:      legacyStatusForStageName(targetStage.name),
          updated_at:  new Date().toISOString(),
        })
        .eq('id', lr.id)
        .eq('venue_id', venue.id);
    }
  } catch (e) {
    console.error('[public/leads] attach default pipeline', e);
  }

  // Fire form-submitted workflow trigger
  try {
    const formId = await ensureListingForm(venue.id);
    if (formId) await onMarketingFormSubmitted(venue.id, lr.id, formId);
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
    { ok: true, lead_id: lead.id, track_token: (lead as { track_token?: string }).track_token ?? null },
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
