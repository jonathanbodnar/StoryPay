/**
 * POST /api/calendar/notifications/test
 *
 * Sends a test message for a single notification channel using the supplied
 * template body (and subject for email). Merge tags are replaced with
 * realistic placeholder values so the venue owner can preview formatting.
 *
 * All test messages — including "contact" channels — are delivered to the
 * venue owner so there is no risk of sending test content to real contacts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { sendEmail } from '@/lib/email';
import { renderTemplate, plainToHtml } from '@/lib/calendar-notifications';

const TEST_VARS: Record<string, string> = {
  'contact.name':                  'Alex Johnson',
  'contact.email':                 'alex@example.com',
  'contact.phone':                 '+1 (555) 234-5678',
  'appointment.title':             'Strategy Call',
  'appointment.start_time':        'Thursday, May 1 at 10:00 AM',
  'appointment.timezone':          'EST',
  'appointment.meeting_location':  'https://zoom.us/j/123456789',
  'venue.name':                    '', // filled in below from real venue data
};

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('email, name, ghl_access_token, ghl_location_id, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const venueName = (venue as { name?: string }).name || 'Us';
  const venueEmail = (venue as { email?: string | null }).email;

  if (!venueEmail) {
    return NextResponse.json({ error: 'No venue email configured. Add one in your venue settings.' }, { status: 400 });
  }

  const varMap = { ...TEST_VARS, 'venue.name': venueName };

  const body = await req.json() as {
    channel: string;
    subject?: string | null;
    body: string;
    /** Recipient override: email address or E.164 phone (+15555555555) */
    testTo: string;
  };

  const { channel, subject, body: rawBody, testTo } = body;
  if (!channel || !rawBody || !testTo) {
    return NextResponse.json({ error: 'channel, body, and testTo are required' }, { status: 400 });
  }

  const renderedBody = renderTemplate(rawBody, varMap);
  const isEmail = channel.startsWith('email_');
  const isContact = channel.endsWith('_contact');
  const recipientLabel = isContact ? 'Contact' : 'Owner';

  try {
    if (isEmail) {
      const renderedSubject = subject
        ? renderTemplate(subject, varMap)
        : `${recipientLabel} notification preview`;

      await sendEmail({
        to: testTo,
        subject: `[TEST – ${recipientLabel}] ${renderedSubject}`,
        html: plainToHtml(
          `⚠️ TEST MESSAGE\n` +
          `In production this would be sent to: ${isContact ? 'the contact/lead' : 'you (venue owner)'}\n\n` +
          `─────────────────────────────────\n\n` +
          renderedBody,
          venueName,
        ),
        from: { name: venueName },
      });
    } else {
      // SMS — send to the specified phone number via GHL
      const ghlToken = (venue as { ghl_access_token?: string | null }).ghl_access_token;
      const locationId = (venue as { ghl_location_id?: string | null }).ghl_location_id;
      const ghlConnected = (venue as { ghl_connected?: boolean | null }).ghl_connected;

      if (!ghlConnected || !ghlToken || !locationId) {
        return NextResponse.json(
          { error: 'GHL is not connected — SMS tests require a connected GHL account.' },
          { status: 400 },
        );
      }

      const { ghlRequest, sendSms, normalizePhone } = await import('@/lib/ghl') as {
        ghlRequest: (path: string, token: string, opts?: Record<string, unknown>) => Promise<{
          contact?: { id?: string };
          contacts?: { id?: string }[];
        }>;
        sendSms: (token: string, locationId: string, contactId: string, message: string) => Promise<unknown>;
        normalizePhone: (phone: string | null | undefined) => string | null;
      };

      const normalizedPhone = normalizePhone(testTo) ?? testTo;
      // Strip to digits only for flexible DB matching
      const digitsOnly = normalizedPhone.replace(/\D/g, '');
      let contactId: string | null = null;

      // 1. Look up in our own database first — fastest and most reliable
      //    Match on the last 10 digits to handle any stored format variation
      const last10 = digitsOnly.slice(-10);
      if (last10.length === 10) {
        const { data: dbContact } = await supabaseAdmin
          .from('venue_customers')
          .select('ghl_contact_id')
          .eq('venue_id', venueId)
          .ilike('phone', `%${last10}`)
          .not('ghl_contact_id', 'is', null)
          .maybeSingle();
        contactId = (dbContact as { ghl_contact_id?: string } | null)?.ghl_contact_id ?? null;
      }

      // 2. GHL phone search fallback
      if (!contactId) {
        try {
          const search = await ghlRequest(
            `/contacts/search/duplicate?locationId=${locationId}&phone=${encodeURIComponent(normalizedPhone)}`,
            ghlToken,
            { locationId },
          );
          contactId = search?.contact?.id ?? search?.contacts?.[0]?.id ?? null;
        } catch { /* fall through */ }
      }

      // 3. GHL email search fallback (catches format mismatches)
      if (!contactId && venueEmail) {
        try {
          const search = await ghlRequest(
            `/contacts/search/duplicate?locationId=${locationId}&email=${encodeURIComponent(venueEmail)}`,
            ghlToken,
            { locationId },
          );
          contactId = search?.contact?.id ?? search?.contacts?.[0]?.id ?? null;
        } catch { /* fall through */ }
      }

      if (!contactId) {
        return NextResponse.json(
          {
            error: `Could not find a GHL contact ID for ${normalizedPhone}. Make sure this contact exists in the SaaS with a GHL contact linked, or is searchable in GHL.`,
          },
          { status: 400 },
        );
      }

      await sendSms(
        ghlToken,
        locationId,
        contactId,
        `[TEST – ${recipientLabel} SMS]\n\n${renderedBody}`,
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notifications/test]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
