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
  // Contact
  'contact.first_name':           'Alex',
  'contact.last_name':            'Johnson',
  'contact.name':                 'Alex Johnson',
  'contact.full_name':            'Alex Johnson',
  'contact.email':                'alex@example.com',
  'contact.phone':                '+1 (555) 234-5678',
  // Appointment
  'appointment.title':            'Strategy Call',
  'appointment.date':             'Thursday, May 1, 2026',
  'appointment.time':             '10:00 AM',
  'appointment.start_time':       'Thursday, May 1 at 10:00 AM',
  'appointment.end_time':         'Thursday, May 1 at 11:00 AM',
  'appointment.duration':         '1 hour',
  'appointment.timezone':         'EST',
  'appointment.meeting_location': 'https://zoom.us/j/123456789',
  'appointment.calendar_name':    'Tour Calendar',
  // Venue — name and owner fields filled in below from real venue data
  'venue.name':                   '',
  'venue.owner_name':             '',
  'venue.owner_first_name':       '',
  'venue.email':                  '',
  'venue.phone':                  '',
  'venue.address':                '',
  'venue.city':                   '',
  'venue.state':                  '',
  'venue.website':                '',
  // System
  'system.date':                  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  'system.year':                  String(new Date().getFullYear()),
};

export async function POST(req: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue, error: venueErr } = await supabaseAdmin
    .from('venues')
    .select('email, name, owner_first_name, owner_last_name, notification_phone, location_full, location_city, location_state, brand_website, ghl_access_token, ghl_location_id, ghl_connected')
    .eq('id', venueId)
    .maybeSingle();

  if (venueErr || !venue) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  const v = venue as {
    name?: string; email?: string | null;
    owner_first_name?: string | null; owner_last_name?: string | null;
    notification_phone?: string | null; location_full?: string | null;
    location_city?: string | null; location_state?: string | null;
    brand_website?: string | null;
  } | null;

  const venueName  = v?.name || 'Us';
  const venueEmail = v?.email;
  const ownerFirst = v?.owner_first_name?.trim() || '';
  const ownerLast  = v?.owner_last_name?.trim()  || '';

  if (!venueEmail) {
    return NextResponse.json({ error: 'No venue email configured. Add one in your venue settings.' }, { status: 400 });
  }

  const varMap = {
    ...TEST_VARS,
    'venue.name':          venueName,
    'venue.owner_name':    [ownerFirst, ownerLast].filter(Boolean).join(' '),
    'venue.owner_first_name': ownerFirst,
    'venue.email':         venueEmail || '',
    'venue.phone':         v?.notification_phone || '',
    'venue.address':       v?.location_full || [v?.location_city, v?.location_state].filter(Boolean).join(', ') || '',
    'venue.city':          v?.location_city  || '',
    'venue.state':         v?.location_state || '',
    'venue.website':       v?.brand_website  || '',
  };

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
          { error: 'Legacy messaging is not connected — SMS tests require a connected Legacy messaging account.' },
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
            error: `Could not find a Legacy contact for ${normalizedPhone}. Make sure this contact exists in the SaaS with a Legacy contact linked.`,
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
