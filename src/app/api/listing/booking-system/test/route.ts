/**
 * Booking System — send a test email or SMS for a single message.
 *
 * POST /api/listing/booking-system/test
 *   Body: {
 *     channel: 'email' | 'sms',
 *     to?: string,          // recipient; email defaults to the venue's own address
 *     subject?: string,     // email only
 *     body: string,         // the message content (live editor value)
 *     preheader?: string,   // email only
 *   }
 *
 * Renders the supplied content the exact same way the Speed-to-Lead worker
 * does for a quick-compose email / SMS (merge tags resolved with preview
 * values), then delivers it so the venue owner can see how it looks before a
 * real lead ever receives it. Nothing is enrolled and no lead state changes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail, buildBulkEmailHeaders, htmlToPlainText, injectPreheaderHtml } from '@/lib/email';
import { mergeMarketingFields } from '@/lib/marketing-email-render';
import { resolveVenueFromAddress } from '@/lib/marketing-email-worker';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms } from '@/lib/ghl';
import { loadVenueFeatureAccess } from '@/lib/plan-features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { channel?: string; to?: string; subject?: string; body?: string; preheader?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const channel = body.channel === 'sms' ? 'sms' : 'email';
  const messageBody = (body.body ?? '').trim();
  if (!messageBody) {
    return NextResponse.json({ error: 'Nothing to test yet — write your message first.' }, { status: 400 });
  }

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select(
      'name, email, notification_email, owner_first_name, owner_last_name, ' +
      'location_full, location_city, location_state, ' +
      'ghl_access_token, ghl_location_id, ghl_connected',
    )
    .eq('id', venueId)
    .maybeSingle();
  if (!venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const v = venue as unknown as Record<string, unknown>;
  const venueName = (v.name as string | null) ?? 'Your venue';
  const ownerName = [v.owner_first_name, v.owner_last_name].filter(Boolean).join(' ') as string;
  const fullAddr = (v.location_full as string | null)
    || [v.location_city, v.location_state].filter(Boolean).join(', ')
    || '';

  // Preview merge values so tags don't render literally in the test.
  const previewVars: Record<string, string> = {
    first_name: 'Preview',
    last_name: 'Contact',
    owner_name: ownerName || venueName,
    venue_name: venueName,
    venue_address: fullAddr,
    venue_full_address: fullAddr,
    appointment_date: 'Fri, Jun 12',
    appointment_time: '2:00 PM',
    pricing_guide_url: '#',
    wedding_date: 'June 12, 2027',
    wedding_month: 'June',
    guest_count: '120',
    'contact.first_name': 'Preview',
    'contact.last_name': 'Contact',
    'venue.name': venueName,
    'venue.owner_name': ownerName || venueName,
  };

  // ── SMS ────────────────────────────────────────────────────────────────
  if (channel === 'sms') {
    const access = await loadVenueFeatureAccess(venueId);
    if (!access.hasSms) {
      return NextResponse.json({ error: 'SMS is not available on your plan.', code: 'sms_not_available' }, { status: 403 });
    }
    const rawPhone = normalizePhone((body.to ?? '').trim());
    if (!rawPhone) return NextResponse.json({ error: 'Enter a valid phone number to send a test text.' }, { status: 400 });
    if (!(v.ghl_connected as boolean | null)) {
      return NextResponse.json({ error: 'Connect your texting (GHL) to send test messages.' }, { status: 400 });
    }
    const token = getGhlToken(v as { ghl_access_token?: string | null });
    const loc = v.ghl_location_id as string | null;
    if (!token || !loc) return NextResponse.json({ error: 'Texting is not fully configured for this venue.' }, { status: 400 });

    const preview = mergeMarketingFields(messageBody, previewVars);
    try {
      const contactId = await findOrCreateContact(token, loc, { phone: rawPhone, firstName: 'Test', lastName: 'Message' });
      if (!contactId) return NextResponse.json({ error: 'Could not reach the texting provider.' }, { status: 500 });
      await sendSms(token, loc, contactId, preview);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send test text' }, { status: 500 });
    }
    return NextResponse.json({ sent: true, to: rawPhone, channel: 'sms' });
  }

  // ── Email ──────────────────────────────────────────────────────────────
  const toEmail = ((body.to ?? '').trim())
    || (v.notification_email as string | null)?.trim()
    || (v.email as string | null)?.trim()
    || '';
  if (!toEmail) {
    return NextResponse.json({ error: 'No email address on file — enter one to send a test.' }, { status: 400 });
  }

  const subject = mergeMarketingFields(String(body.subject ?? ''), previewVars);
  const mergedBody = mergeMarketingFields(messageBody, previewVars);
  const preheader = mergeMarketingFields(String(body.preheader ?? ''), previewVars);

  const looksLikeHtml = /<\/?[a-z][\s\S]*?>/i.test(mergedBody);
  const bodyHtml = looksLikeHtml ? mergedBody : escapeHtml(mergedBody).replace(/\n/g, '<br>');
  const rawHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f6f7f9;font-family:Helvetica,Arial,sans-serif;color:#1f2937;line-height:1.55;"><div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">${bodyHtml}</div></body></html>`;
  const html = injectPreheaderHtml(rawHtml, preheader);

  const { fromName, fromEmail, replyTo } = await resolveVenueFromAddress(venueId);
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io';
  const previewUnsub = `${appOrigin.replace(/\/$/, '')}/api/public/marketing/unsubscribe?token=preview`;

  const result = await sendEmail({
    to: toEmail,
    subject: `[TEST] ${subject || '(no subject)'}`,
    html,
    text: htmlToPlainText(html),
    replyTo,
    from: fromEmail ? { name: fromName, email: fromEmail } : { name: fromName },
    headers: buildBulkEmailHeaders(previewUnsub),
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Failed to send test email' }, { status: 500 });
  }
  return NextResponse.json({ sent: true, to: toEmail, channel: 'email' });
}
