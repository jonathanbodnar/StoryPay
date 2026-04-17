import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LEAD_WEBHOOK_SECRET = process.env.LEAD_WEBHOOK_SECRET || '';
const DIRECTORY_URL = process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com';

/**
 * Timing-safe HMAC comparison.
 * Returns false if the signature doesn't match or either input is malformed.
 */
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
  name?: string;
  email?: string;
  phone?: string;
  event_date?: string;
  wedding_date?: string;
  guest_count?: number;
  booking_timeline?: string;
  message?: string;
  source?: string;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Public inbound lead webhook. The directory site signs the raw request body
 * with HMAC-SHA256 using LEAD_WEBHOOK_SECRET and sends it as
 * `x-storypay-signature`. We resolve the StoryPay venue, insert a lead row,
 * and (if enabled) email the owner.
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

  const name = (payload.name ?? '').trim();
  const email = (payload.email ?? '').trim().toLowerCase();
  const phone = (payload.phone ?? '').trim();

  if (!name || !email || !isEmail(email)) {
    return NextResponse.json({ error: 'name and valid email required' }, { status: 400 });
  }

  const slug = payload.listing_slug ?? payload.venue_slug;
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
    return NextResponse.json(
      { error: `Lookup failed: ${venueErr.message}` },
      { status: 500 },
    );
  }

  if (!venue) {
    console.warn('[public/leads] venue not found:', venueId ?? slug);
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const weddingDate = payload.wedding_date ?? payload.event_date ?? null;

  const { data: lead, error: insertErr } = await supabaseAdmin
    .from('leads')
    .insert({
      venue_id: venue.id,
      name,
      email,
      phone: phone || null,
      wedding_date: weddingDate,
      guest_count: payload.guest_count ?? null,
      booking_timeline: payload.booking_timeline || null,
      message: payload.message || null,
      source: payload.source || 'directory',
    })
    .select('id, track_token')
    .single();

  if (insertErr || !lead) {
    console.error('[public/leads] insert failed:', insertErr);
    return NextResponse.json(
      { error: `Failed to save lead: ${insertErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  const notifyEnabled = venue.email_notifications !== false;
  if (notifyEnabled) {
    const notifyTo = venue.notification_email || venue.email || undefined;

    if (notifyTo) {
      const venueName = venue.name ?? 'your venue';
      const listingLink = venue.slug ? `${DIRECTORY_URL}/venue/${venue.slug}` : DIRECTORY_URL;
      const html = `
        <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1b1b1b;">
          <h2 style="margin: 0 0 16px;">New lead for ${escapeHtml(venueName)}</h2>
          <p style="margin: 0 0 16px;">You just received a new inquiry from the StoryVenue directory.</p>
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Name', name)}
            ${row('Email', email)}
            ${phone ? row('Phone', phone) : ''}
            ${weddingDate ? row('Wedding date', weddingDate) : ''}
            ${payload.guest_count ? row('Guest count', String(payload.guest_count)) : ''}
            ${payload.booking_timeline ? row('Timeline', payload.booking_timeline) : ''}
            ${payload.message ? row('Message', payload.message) : ''}
          </table>
          <p style="margin: 24px 0;">
            <a href="${escapeHtml(listingLink)}" style="color: #1b1b1b;">View listing</a> •
            Manage in your dashboard.
          </p>
        </div>
      `;
      await sendEmail({
        to: notifyTo,
        replyTo: email,
        subject: `New lead: ${name} — ${venueName}`,
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
  return `<tr><td style="padding: 4px 12px 4px 0; color: #666;">${escapeHtml(label)}</td><td style="padding: 4px 0;">${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
