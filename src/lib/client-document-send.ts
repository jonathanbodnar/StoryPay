/**
 * Sending a proposal or invoice to the client. SERVER-ONLY.
 *
 * One email, not two: the venue's branded template (Settings → Notifications,
 * "Proposal" or "Invoice"). A CRM-connected venue sends it through its CRM, so
 * it shows in the conversation and the client's reply lands there. Without a
 * CRM, or if the CRM send fails, it goes out directly under the venue's name
 * with replies going to the venue. The text message is unchanged: sent through
 * the CRM when the client has a phone number.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { findOrCreateContact, getGhlToken, normalizePhone, resolveLocationToken, sendEmail as ghlSendEmail, sendSms } from '@/lib/ghl';
import { sendEmail as directSendEmail } from '@/lib/email';
import { buildEmailHtml, fillTemplate, getVenueEmailTemplate } from '@/lib/email-templates';

export type ClientDocumentKind = 'proposal' | 'invoice';

export interface SendClientDocumentResult {
  /** crm: sent through the venue's CRM; direct: sent by StoryVenue; off: the venue turned this email off. */
  email: 'crm' | 'direct' | 'off' | 'failed';
  texted: boolean;
}

export async function sendClientDocument(args: {
  venueId: string;
  kind: ClientDocumentKind;
  /** The client's link (/proposal/[token]). */
  url: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  /** A CRM contact the venue already picked, if any. */
  ghlContactId?: string | null;
  /** Template merge values: amount, invoice_number, due_date. */
  vars: Record<string, string>;
}): Promise<SendClientDocumentResult> {
  const { venueId, kind, url } = args;
  const { data } = await supabaseAdmin
    .from('venues')
    .select('name, email, brand_email, brand_color, brand_logo_url, ghl_location_id, ghl_access_token')
    .eq('id', venueId)
    .maybeSingle();
  const venue = (data ?? {}) as {
    name?: string | null; email?: string | null; brand_email?: string | null; brand_color?: string | null;
    brand_logo_url?: string | null; ghl_location_id?: string | null; ghl_access_token?: string | null;
  };
  const venueName = venue.name || 'Your Venue';
  const firstName = (args.customerName || '').trim().split(/\s+/)[0] || 'there';

  // The branded email (null when the venue turned it off).
  const tmpl = await getVenueEmailTemplate(venueId, kind);
  const vars: Record<string, string> = { organization: venueName, customer_name: args.customerName || 'there', ...args.vars };
  const subject = tmpl ? fillTemplate(tmpl.subject, vars) : '';
  const html = tmpl
    ? buildEmailHtml({
        template: tmpl,
        vars,
        actionUrl: url,
        brandColor: venue.brand_color || '#1b1b1b',
        logoUrl: venue.brand_logo_url || undefined,
        venueName,
      })
    : '';

  let texted = false;
  let sentThroughCrm = false;
  const ghlToken = venue.ghl_location_id ? getGhlToken(venue) : null;
  if (venue.ghl_location_id && ghlToken) {
    try {
      const contactId =
        args.ghlContactId ||
        (await findOrCreateContact(ghlToken, venue.ghl_location_id, {
          email: args.customerEmail,
          phone: normalizePhone(args.customerPhone ?? '') || undefined,
          firstName,
          lastName: (args.customerName || '').trim().split(/\s+/).slice(1).join(' ') || undefined,
        }));
      if (contactId) {
        const phone = normalizePhone(args.customerPhone ?? '');
        if (phone) {
          try {
            await sendSms(
              ghlToken,
              venue.ghl_location_id,
              contactId,
              kind === 'invoice'
                ? `Hi ${firstName}, ${venueName} has sent you an invoice. View and pay here: ${url}`
                : `Hi ${firstName}, ${venueName} has sent you a proposal. View and sign here: ${url}`,
            );
            texted = true;
          } catch (e) {
            console.error(`[send-${kind}] SMS failed:`, e);
          }
        }
        if (tmpl) {
          try {
            const token = await resolveLocationToken(ghlToken, venue.ghl_location_id);
            await ghlSendEmail(token, venue.ghl_location_id, { contactId, subject, html });
            sentThroughCrm = true;
          } catch (e) {
            console.error(`[send-${kind}] CRM email failed, sending directly instead:`, e);
          }
        }
      }
    } catch (e) {
      console.error(`[send-${kind}] CRM contact lookup failed:`, e);
    }
  }

  if (!tmpl) return { email: 'off', texted };
  if (sentThroughCrm) return { email: 'crm', texted };

  const r = await directSendEmail({
    to: args.customerEmail,
    subject,
    html,
    from: { name: venueName },
    replyTo: venue.brand_email || venue.email || undefined,
  });
  if (!r.success) console.error(`[send-${kind}] email failed:`, r.error);
  return { email: r.success ? 'direct' : 'failed', texted };
}
