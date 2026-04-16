import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

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
  /** Directory slug of the venue being inquired about. */
  listing_slug?: string;
  /** Back-compat alias. */
  venue_slug?: string;
  /** Direct venue id (if the directory already has it). */
  venue_id?: string;
  /** Back-compat alias for `venue_id` — older directory builds used this name. */
  venue_listing_id?: string;
  name?: string;
  email?: string;
  phone?: string;
  /** ISO date string. Mapped to `leads.wedding_date`. */
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

  const sql = getDb();

  const slug = payload.listing_slug ?? payload.venue_slug;
  const venueId = payload.venue_id ?? payload.venue_listing_id;
  const venueRows = venueId
    ? await sql`
        SELECT id, slug, name, email, notification_email, email_notifications
        FROM public.venues WHERE id = ${venueId} LIMIT 1
      `
    : slug
      ? await sql`
          SELECT id, slug, name, email, notification_email, email_notifications
          FROM public.venues WHERE slug = ${slug} LIMIT 1
        `
      : [];

  if (venueRows.length === 0) {
    console.warn('[public/leads] venue not found:', venueId ?? slug);
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const venue = venueRows[0] as {
    id: string;
    slug: string | null;
    name: string | null;
    email: string | null;
    notification_email: string | null;
    email_notifications: boolean | null;
  };

  const weddingDate = payload.wedding_date ?? payload.event_date ?? null;

  const insertResult = await sql`
    INSERT INTO public.leads (
      venue_id, name, email, phone,
      wedding_date, guest_count, booking_timeline, message, source
    ) VALUES (
      ${venue.id}, ${name}, ${email}, ${phone || null},
      ${weddingDate}, ${payload.guest_count ?? null}, ${payload.booking_timeline || null},
      ${payload.message || null}, ${payload.source || 'directory'}
    )
    RETURNING id
  `;

  const lead = insertResult[0] as { id: string };

  // Notify the venue owner (default on if flag is null/true).
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

  return NextResponse.json({ ok: true, lead_id: lead.id }, { status: 201 });
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
