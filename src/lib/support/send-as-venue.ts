/**
 * sendAsVenue — single helper that lets a StoryVenue support agent reply to a
 * bride on behalf of the venue.
 *
 * Mirrors the venue's own conversations reply pipeline (SMS via GHL, email via
 * Resend with per-thread Reply-To) so the bride can't tell the difference, but
 * tags every outbound row with:
 *   - sender_kind            = 'concierge'
 *   - sent_on_behalf_of_venue = true
 *   - sent_by_support_user_id = <support agent id>
 *
 * The venue inbox renders these with a "Sent by StoryVenue Support" badge.
 *
 * No retries, no fallbacks — surface the error to the caller.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import {
  sendSms as ghlSendSms,
  findOrCreateContact,
  getGhlToken,
  normalizePhone,
} from '@/lib/ghl';
import { buildConversationsReplyToEmail } from '@/lib/conversations-inbound-email';

const PLACEHOLDER_SMS_EMAIL_DOMAIN = 'ghl-sms.storypay.placeholder';

export type SupportReplyChannel = 'sms' | 'email';

export interface SendAsVenueInput {
  venueId:        string;
  /** Lead row to attribute the activity to. Optional — threads can exist
   *  without a matching lead (e.g. raw inbound SMS), in which case we still
   *  send the reply but skip the lead_activity_log entry. */
  leadId:         string | null;
  body:           string;
  supportUserId:  string;
  channel:        SupportReplyChannel;
  /** Optional internal note recorded on the conversation_messages row. */
  internalNote?:  string;
  /** Optional override for email subject. Falls back to thread subject. */
  emailSubject?:  string;
  /** Optional thread id to use directly. When omitted, we look up by lead/email. */
  threadId?:      string;
}

export type SendAsVenueResult =
  | { ok: true;  threadId: string; messageId: string; }
  | { ok: false; error: string; threadId?: string; };

interface VenueCredsRow {
  ghl_access_token: string | null;
  ghl_location_id:  string | null;
  ghl_connected:    boolean | null;
  name:             string | null;
  brand_email:      string | null;
}

interface LeadRow {
  id:         string;
  email:      string | null;
  phone:      string | null;
  first_name: string | null;
  last_name:  string | null;
  name:       string | null;
}

interface VenueCustomerRow {
  id:               string;
  customer_email:   string | null;
  first_name:       string | null;
  last_name:        string | null;
  phone:            string | null;
  ghl_contact_id:   string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendAsVenue(input: SendAsVenueInput): Promise<SendAsVenueResult> {
  const { venueId, leadId, supportUserId, channel } = input;
  const body = (input.body || '').trim();
  if (!body) return { ok: false, error: 'Empty message body' };

  // 1. Load lead (optional)
  let lead: LeadRow | null = null;
  if (leadId) {
    const { data: leadData } = await supabaseAdmin
      .from('leads')
      .select('id, email, phone, first_name, last_name, name')
      .eq('id', leadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    lead = leadData as LeadRow | null;
    if (!lead) return { ok: false, error: 'Lead not found' };
  }

  // 2. Resolve venue_customer + thread.
  let threadId: string;
  let threadSubject = 'Conversation';
  let vc: VenueCustomerRow | null = null;

  if (input.threadId) {
    // Fast path: caller already knows the thread (bride inbox case).
    const { data: tRow } = await supabaseAdmin
      .from('conversation_threads')
      .select('id, subject, venue_customer_id')
      .eq('id', input.threadId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!tRow) return { ok: false, error: 'Thread not found' };
    threadId = (tRow as { id: string }).id;
    threadSubject = ((tRow as { subject?: string }).subject || 'Conversation').trim() || 'Conversation';
    const vcId = (tRow as { venue_customer_id: string }).venue_customer_id;
    const { data: vcRow } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone, ghl_contact_id')
      .eq('id', vcId)
      .maybeSingle();
    vc = vcRow as VenueCustomerRow | null;
    if (!vc) return { ok: false, error: 'Thread customer not found', threadId };
  } else {
    // Derive thread from lead.email
    const leadEmail = (lead?.email || '').trim().toLowerCase();
    if (!leadEmail) return { ok: false, error: 'Lead has no email — pass threadId or set lead.email' };

    const { data: vcData } = await supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone, ghl_contact_id')
      .eq('venue_id', venueId)
      .ilike('customer_email', leadEmail)
      .maybeSingle();
    vc = vcData as VenueCustomerRow | null;

    if (!vc) {
      const fn = lead?.first_name?.trim() || lead?.name?.split(/\s+/)[0] || '';
      const ln = lead?.last_name?.trim() || '';
      const { data: created, error: vcErr } = await supabaseAdmin
        .from('venue_customers')
        .insert({
          venue_id:       venueId,
          customer_email: leadEmail,
          first_name:     fn || null,
          last_name:      ln || null,
          phone:          lead?.phone || null,
        })
        .select('id, customer_email, first_name, last_name, phone, ghl_contact_id')
        .single();
      if (vcErr || !created) {
        return { ok: false, error: `Could not create venue customer: ${vcErr?.message || 'unknown'}` };
      }
      vc = created as VenueCustomerRow;
    }

    const { data: existing } = await supabaseAdmin
      .from('conversation_threads')
      .select('id, subject')
      .eq('venue_id', venueId)
      .eq('venue_customer_id', vc.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      threadId = (existing as { id: string }).id;
      threadSubject = ((existing as { subject?: string }).subject || 'Conversation').trim() || 'Conversation';
    } else {
      const { data: newThread, error: tErr } = await supabaseAdmin
        .from('conversation_threads')
        .insert({
          venue_id:               venueId,
          venue_customer_id:      vc.id,
          subject:                'Conversation',
          external_reply_channel: channel,
        })
        .select('id')
        .single();
      if (tErr || !newThread) {
        return { ok: false, error: `Could not create thread: ${tErr?.message || 'unknown'}` };
      }
      threadId = (newThread as { id: string }).id;
    }
  }

  // 4. Load venue credentials
  const { data: venueData } = await supabaseAdmin
    .from('venues')
    .select('ghl_access_token, ghl_location_id, ghl_connected, name, brand_email')
    .eq('id', venueId)
    .maybeSingle();
  const venue = venueData as VenueCredsRow | null;
  if (!venue) return { ok: false, error: 'Venue not found', threadId };

  // 5. Send via the chosen channel
  let externalSent = false;
  let sendError: string | null = null;

  if (channel === 'sms') {
    if (!venue.ghl_connected || !venue.ghl_location_id) {
      return { ok: false, error: 'Venue has not connected GHL — cannot send SMS', threadId };
    }
    const token = getGhlToken({ ghl_access_token: venue.ghl_access_token });
    if (!token) {
      return { ok: false, error: 'No GHL access token available for this venue', threadId };
    }
    const phoneE164 = normalizePhone(vc.phone || lead?.phone || null);
    if (!phoneE164) {
      return { ok: false, error: 'No usable phone number for SMS', threadId };
    }

    let contactId = vc.ghl_contact_id || null;
    try {
      if (!contactId) {
        const fallbackEmail = (vc.customer_email || lead?.email || '').trim();
        const placeholderEmail = fallbackEmail || `ghl.${vc.id}@${PLACEHOLDER_SMS_EMAIL_DOMAIN}`;
        contactId = await findOrCreateContact(token, venue.ghl_location_id, {
          email:     placeholderEmail,
          phone:     phoneE164,
          firstName: vc.first_name || lead?.first_name || undefined,
          lastName:  vc.last_name  || lead?.last_name  || undefined,
        });
        if (contactId) {
          await supabaseAdmin
            .from('venue_customers')
            .update({ ghl_contact_id: contactId })
            .eq('id', vc.id)
            .eq('venue_id', venueId);
        }
      }
      if (!contactId) {
        return { ok: false, error: 'Could not resolve a GHL contact for this lead', threadId };
      }
      await ghlSendSms(token, venue.ghl_location_id, contactId, body);
      externalSent = true;
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'SMS send failed';
      return { ok: false, error: sendError, threadId };
    }
  } else {
    // email
    const to = (vc.customer_email || lead?.email || '').trim();
    if (!to) {
      return { ok: false, error: 'No email address available to reply to', threadId };
    }
    const venueName = venue.name || 'Venue';
    const brandEmail = venue.brand_email?.trim() || undefined;

    const html = `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
${escapeHtml(body)
  .split(/\n+/)
  .map((p) => `<p style="margin:0 0 12px">${p}</p>`)
  .join('')}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
<p style="font-size:12px;color:#6b7280">Sent via StoryVenue Conversations — reply to this email to continue the thread.</p>
</div>`;

    const subject = (input.emailSubject?.trim() || threadSubject).trim() || `Message from ${venueName}`;
    const replyRouting = buildConversationsReplyToEmail(threadId, venueId);

    const result = await sendEmail({
      to,
      replyTo: replyRouting || brandEmail,
      subject,
      html,
      from: { name: venueName, email: brandEmail },
    });

    if (!result.success) {
      return { ok: false, error: result.error || 'Email send failed', threadId };
    }
    externalSent = true;
  }

  // 6. Log conversation_messages row
  const insertRow: Record<string, unknown> = {
    thread_id:                 threadId,
    visibility:                'external',
    channel,
    body,
    sender_kind:               'concierge',
    sent_by_support_user_id:   supportUserId,
    sent_on_behalf_of_venue:   true,
    external_email_sent:       externalSent,
    send_error:                sendError,
  };
  if (input.internalNote && input.internalNote.trim()) {
    insertRow.support_internal_note = input.internalNote.trim();
  }
  if (channel === 'email') {
    insertRow.email_subject = input.emailSubject?.trim() || threadSubject;
  }

  const { data: msgRow, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert(insertRow)
    .select('id')
    .single();

  if (insErr || !msgRow) {
    return { ok: false, error: `Logged send but could not insert message: ${insErr?.message || 'unknown'}`, threadId };
  }
  const messageId = (msgRow as { id: string }).id;

  // Keep the thread's external_reply_channel in sync with what was sent
  await supabaseAdmin
    .from('conversation_threads')
    .update({ external_reply_channel: channel })
    .eq('id', threadId)
    .eq('venue_id', venueId);

  // 7. Lead activity log — actor is null/false because support isn't a venue team member.
  //    Skipped when there's no matching lead row (raw inbound SMS, etc.)
  if (leadId) {
    await supabaseAdmin.from('lead_activity_log').insert({
      venue_id:        venueId,
      lead_id:         leadId,
      actor_member_id: null,
      actor_is_owner:  false,
      action:          'support_reply_sent',
      details: {
        support_user_id: supportUserId,
        channel,
        message_id:      messageId,
        thread_id:       threadId,
      },
    });
  }

  return { ok: true, threadId, messageId };
}
