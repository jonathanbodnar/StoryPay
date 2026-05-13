/**
 * GHL SMS diagnostic — runs every check that's relevant to "why won't my SMS
 * go through?" and returns a single JSON blob you can read directly in the
 * browser (no Railway log digging needed).
 *
 * Hit:  GET /api/integrations/ghl/diagnose-sms?contactId=<vc_id>
 *
 * `contactId` is the venue_customers.id of the StoryVenue contact you're
 * trying to text (e.g. the contact whose conversation thread shows the SMS
 * failure). If omitted, contact-level checks are skipped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import {
  classifyToken,
  ghlRequest,
  normalizePhone,
} from '@/lib/ghl';
import { ensureLocationToken } from '@/lib/ghl-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Check = {
  step: string;
  ok: boolean;
  detail: string;
  data?: unknown;
};

function ok(step: string, detail: string, data?: unknown): Check {
  return { step, ok: true, detail, data };
}
function fail(step: string, detail: string, data?: unknown): Check {
  return { step, ok: false, detail, data };
}

export async function GET(req: NextRequest) {
  let venueId: string;
  try {
    venueId = await requireVenueId();
  } catch {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const venueCustomerId = req.nextUrl.searchParams.get('contactId');
  const checks: Check[] = [];

  // 1. Venue + token
  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('id, name, ghl_location_id, ghl_access_token, ghl_connected')
    .eq('id', venueId)
    .single();

  if (!venue?.ghl_location_id) {
    checks.push(fail('venue', 'Venue has no ghl_location_id set'));
    return NextResponse.json({ venueId, checks });
  }
  if (!venue.ghl_connected) {
    checks.push(fail('venue', 'Venue ghl_connected is false (Legacy messaging not enabled)'));
    return NextResponse.json({ venueId, checks });
  }
  checks.push(ok('venue', `Venue has ghl_location_id=${venue.ghl_location_id} and ghl_connected=true`));

  let token: string;
  try {
    token = await ensureLocationToken({
      id: venueId,
      ghl_location_id: venue.ghl_location_id,
      ghl_access_token: (venue as { ghl_access_token?: string | null }).ghl_access_token ?? null,
    });
  } catch (e) {
    checks.push(fail('token', `ensureLocationToken failed: ${e instanceof Error ? e.message : String(e)}`));
    return NextResponse.json({ venueId, checks });
  }
  const tokenKind = classifyToken(token);
  checks.push(ok('token', `Resolved a working token. tokenKind=${tokenKind}`));

  // 2. Sub-account phone numbers (FROM side). GHL refuses to send SMS if
  // the sub-account has no provisioned numbers — and the error message is
  // the same "Missing phone number" 422, which is super confusing.
  try {
    const numbersRes = (await ghlRequest(
      `/phone-system/numbers/${encodeURIComponent(venue.ghl_location_id)}`,
      token,
      { locationId: venue.ghl_location_id },
    )) as { numbers?: Array<{ phoneNumber?: string }> ; phoneNumbers?: Array<{ phoneNumber?: string }> };
    const numbers = numbersRes.numbers ?? numbersRes.phoneNumbers ?? [];
    if (numbers.length === 0) {
      checks.push(
        fail(
          'sub_account_phone_numbers',
          'The GHL sub-account has NO provisioned phone numbers — this is almost certainly why SMS fails. ' +
          'Open the sub-account in GoHighLevel → Settings → Phone Numbers and buy/assign a Twilio number.',
          numbersRes,
        ),
      );
    } else {
      checks.push(
        ok(
          'sub_account_phone_numbers',
          `Sub-account has ${numbers.length} phone number(s) provisioned.`,
          numbers.map((n) => n.phoneNumber).filter(Boolean),
        ),
      );
    }
  } catch (e) {
    // Try the alternate v1/v2 paths before giving up
    const msg = e instanceof Error ? e.message : String(e);
    checks.push(
      fail(
        'sub_account_phone_numbers',
        `Could not list phone numbers for the sub-account. This usually means the API key doesn't have the ` +
        `"phone-numbers" scope. SMS may still work if a number is provisioned — but we can't confirm. Raw: ${msg.slice(0, 300)}`,
      ),
    );
  }

  // 3. Contact-level checks (only if user passed contactId)
  if (venueCustomerId) {
    const { data: vc } = await supabaseAdmin
      .from('venue_customers')
      .select('id, first_name, last_name, customer_email, phone, ghl_contact_id, sms_dnd, conversation_dnd_all')
      .eq('id', venueCustomerId)
      .eq('venue_id', venueId)
      .maybeSingle();

    if (!vc) {
      checks.push(fail('contact_local', `No venue_customers row found for id=${venueCustomerId}`));
      return NextResponse.json({ venueId, checks });
    }

    const localPhone = normalizePhone((vc as { phone?: string | null }).phone ?? null);
    checks.push(
      ok('contact_local', `Local contact: ${vc.first_name ?? ''} ${vc.last_name ?? ''}`.trim(), {
        rawPhone: (vc as { phone?: string }).phone,
        normalizedPhone: localPhone,
        customer_email: (vc as { customer_email?: string }).customer_email,
        ghl_contact_id: (vc as { ghl_contact_id?: string }).ghl_contact_id,
        sms_dnd: (vc as { sms_dnd?: boolean }).sms_dnd,
        conversation_dnd_all: (vc as { conversation_dnd_all?: boolean }).conversation_dnd_all,
      }),
    );

    if (!localPhone) {
      checks.push(fail('contact_local_phone', 'Local contact has no usable phone number'));
    }
    if ((vc as { sms_dnd?: boolean }).sms_dnd) {
      checks.push(fail('contact_sms_dnd', 'Local contact has sms_dnd=true (they texted STOP or admin set it).'));
    }
    if ((vc as { conversation_dnd_all?: boolean }).conversation_dnd_all) {
      checks.push(fail('contact_dnd_all', 'Local contact has conversation_dnd_all=true.'));
    }

    const ghlContactId = (vc as { ghl_contact_id?: string }).ghl_contact_id;
    if (!ghlContactId) {
      checks.push(fail('contact_ghl_id', 'Local contact has no ghl_contact_id — SMS sends will need to create one first.'));
    } else {
      try {
        const ghlContact = (await ghlRequest(
          `/contacts/${encodeURIComponent(ghlContactId)}`,
          token,
          { locationId: venue.ghl_location_id },
        )) as { contact?: Record<string, unknown> } & Record<string, unknown>;
        const c = (ghlContact.contact ?? ghlContact) as {
          phone?: string;
          email?: string;
          firstName?: string;
          lastName?: string;
        };
        checks.push(
          ok('contact_ghl', `GHL contact ${ghlContactId} fetched successfully`, {
            ghlPhone: c.phone,
            ghlEmail: c.email,
            ghlFirstName: c.firstName,
            ghlLastName: c.lastName,
            phoneMatchesLocal: !!c.phone && !!localPhone &&
              c.phone.replace(/\D/g, '').replace(/^1/, '') ===
              localPhone.replace(/\D/g, '').replace(/^1/, ''),
          }),
        );

        if (!c.phone) {
          checks.push(
            fail(
              'contact_ghl_phone',
              `GHL's copy of contact ${ghlContactId} has NO phone stored. SMS sends will fail with 422 ` +
              `"Missing phone number" until this is fixed. Open the contact in GoHighLevel and add the phone, ` +
              `or trigger a contact sync from StoryVenue → Settings.`,
            ),
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        checks.push(fail('contact_ghl', `GET /contacts/${ghlContactId} failed: ${msg.slice(0, 300)}`));
      }
    }
  }

  const allOk = checks.every((c) => c.ok);
  return NextResponse.json({
    venueId,
    summary: allOk
      ? 'All checks passed — SMS should work. If it still fails, paste the Railway [ghl] log lines from the failed send.'
      : `${checks.filter((c) => !c.ok).length} check(s) failed. See "ok: false" items below.`,
    checks,
  });
}
