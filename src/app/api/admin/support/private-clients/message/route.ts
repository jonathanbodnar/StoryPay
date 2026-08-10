/**
 * POST /api/admin/support/private-clients/message
 *
 * Sends a one-off email or SMS directly to a Private Client venue's owner or
 * a team member, from the Support Inbox → Private Clients tab. This is a
 * side channel to the *account holders* themselves — separate from the
 * Venue Direct feature, which is scoped to a specific bride/lead thread.
 *
 * Body:
 *   {
 *     venueId:       string;
 *     recipientType: 'owner' | 'team_member';
 *     teamMemberId?: string;   // required when recipientType === 'team_member'
 *     channel:       'email' | 'sms';
 *     body:          string;
 *     supportUserId?: string;  // identity-picker fallback for super admin
 *     context?:      'private_client' | 'venue_contact';
 *   }
 *
 * `context` picks the outbound branding/signature:
 *   - 'private_client' (default) — Private Clients tab. Signed
 *     "StoryVenue Client Services", From/Reply-To stay on support@.
 *     Requires the venue to be flagged is_private_client.
 *   - 'venue_contact' — the venue owner/team contact card shown on a
 *     bride/lead thread's context sidebar. Signed "– {Agent}, StoryVenue
 *     Concierge" (or just "– StoryVenue Concierge" for super admin), and
 *     routes From/Reply-To to clients@storyvenue.com. Works for any venue,
 *     not just Private Clients.
 *
 * SMS works for the owner or any team member with a phone on file — it
 * rides the venue's own GHL/A2P connection. Owner phone is resolved as
 * venues.notification_phone falling back to venues.phone; team member
 * phone comes from venue_team_members.phone.
 *
 * Auth: super admin OR support agent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms as ghlSendSms } from '@/lib/ghl';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';
import { CLIENT_SERVICES_SIGNATURE_HTML, CLIENT_SERVICES_EMAIL } from '@/lib/support/client-services-signature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHARS = 5000;

interface Body {
  venueId?:       string;
  recipientType?: 'owner' | 'team_member';
  teamMemberId?:  string;
  channel?:       'email' | 'sms';
  body?:          string;
  subject?:       string;
  supportUserId?: string;
  context?:       'private_client' | 'venue_contact';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try { body = (await req.json()) as Body; } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueId = (body.venueId || '').trim();
  const recipientType = body.recipientType;
  const channel = body.channel;
  const text = (body.body || '').trim();
  const subject = (body.subject || '').trim() || 'Message from StoryVenue Support';

  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });
  if (recipientType !== 'owner' && recipientType !== 'team_member') {
    return NextResponse.json({ error: 'recipientType must be "owner" or "team_member"' }, { status: 400 });
  }
  if (channel !== 'email' && channel !== 'sms') {
    return NextResponse.json({ error: 'channel must be "email" or "sms"' }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `Message exceeds ${MAX_CHARS} chars` }, { status: 400 });
  }

  const isVenueContact = body.context === 'venue_contact';

  // Resolve acting agent (same identity-picker fallback pattern as Venue Direct).
  let actingAgentId = auth.agent?.sub || (body.supportUserId?.trim() || '');
  if (!actingAgentId && auth.isSuperAdmin) {
    const sa = await ensureSuperAdminSupportMember();
    actingAgentId = sa.id;
  }
  if (!actingAgentId) {
    return NextResponse.json({ error: 'Pick a support identity first' }, { status: 400 });
  }
  if (actingAgentId === SUPER_ADMIN_SUPPORT_USER_ID) {
    await ensureSuperAdminSupportMember();
  }

  // Agent first name for the "– {Agent}, StoryVenue Concierge" signature —
  // only needed for the venue-contact context, and only for named agents
  // (Super Admin gets the generic "StoryVenue Concierge" sign-off).
  let agentFirstName: string | null = null;
  if (isVenueContact && actingAgentId !== SUPER_ADMIN_SUPPORT_USER_ID) {
    const { data: stmRow } = await supabaseAdmin
      .from('support_team_members')
      .select('name')
      .eq('id', actingAgentId)
      .maybeSingle();
    const n = (stmRow as { name?: string | null } | null)?.name?.trim();
    if (n) agentFirstName = n.split(/\s+/)[0];
  }

  const { data: venueRow } = await supabaseAdmin
    .from('venues')
    .select('id, name, slug, email, notification_email, notification_phone, phone, ghl_access_token, ghl_location_id, ghl_connected, owner_id, is_private_client')
    .eq('id', venueId)
    .maybeSingle();
  if (!venueRow) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  const venue = venueRow as {
    id: string; name: string | null; slug: string | null; email: string | null;
    notification_email: string | null; notification_phone: string | null; phone: string | null;
    ghl_access_token: string | null; ghl_location_id: string | null; ghl_connected: boolean | null;
    owner_id: string | null; is_private_client: boolean | null;
  };

  // Gate: venue must be a private client to send from the Private Clients
  // panel. The venue-contact context (contact card on a bride/lead thread)
  // is open to any venue.
  if (!isVenueContact && !venue.is_private_client) {
    return NextResponse.json(
      { error: 'Venue is not a Private Client.' },
      { status: 403 },
    );
  }

  // Resolve recipient
  let recipientLabel = '';
  let recipientEmail: string | null = null;
  let recipientPhone: string | null = null;
  let recipientTeamMemberId: string | null = null;

  if (recipientType === 'owner') {
    recipientLabel = 'Account owner';
    if (venue.owner_id) {
      try {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(venue.owner_id);
        recipientEmail = authUser?.user?.email?.trim() || null;
      } catch (e) {
        console.warn('[private-clients/message] could not fetch owner auth email', e);
      }
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', venue.owner_id)
        .maybeSingle();
      const fullName = (profileRow as { full_name?: string | null } | null)?.full_name?.trim();
      if (fullName) recipientLabel = fullName;
    }
    recipientEmail = recipientEmail || venue.notification_email || venue.email || null;
    recipientPhone = venue.notification_phone || venue.phone || null;
  } else {
    const teamMemberId = (body.teamMemberId || '').trim();
    if (!teamMemberId) return NextResponse.json({ error: 'teamMemberId required for recipientType=team_member' }, { status: 400 });
    const { data: tmRow } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, name, first_name, last_name, email, phone')
      .eq('id', teamMemberId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!tmRow) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    const tm = tmRow as { id: string; name: string | null; first_name: string | null; last_name: string | null; email: string | null; phone: string | null };
    recipientTeamMemberId = tm.id;
    recipientLabel = tm.name || [tm.first_name, tm.last_name].filter(Boolean).join(' ').trim() || tm.email || 'Team member';
    recipientEmail = tm.email || null;
    recipientPhone = tm.phone || null;
  }

  let externalSent = false;
  let sendError: string | null = null;
  // Cached when channel === 'sms' so the reply-tracking poller
  // (src/lib/concierge-sms-sync.ts) knows which GHL contact to watch for a
  // text-back from this recipient.
  let smsGhlContactId: string | null = null;

  if (channel === 'email') {
    if (!recipientEmail) {
      return NextResponse.json({ error: 'No email address on file for this recipient' }, { status: 400 });
    }
    const venueName = venue.name || 'your venue';
    const fromEmail = isVenueContact
      ? CLIENT_SERVICES_EMAIL
      : (process.env.SUPPORT_FROM_EMAIL?.trim() || 'support@storyvenue.com');
    const replyTo = isVenueContact
      ? CLIENT_SERVICES_EMAIL
      : (process.env.SUPPORT_REPLY_TO?.trim() || fromEmail);
    const fromName = isVenueContact ? 'StoryVenue Concierge' : 'StoryVenue Client Services';
    const signOff = isVenueContact
      ? `<p style="margin:20px 0 0">– ${escapeHtml(agentFirstName ? `${agentFirstName}, StoryVenue Concierge` : 'StoryVenue Concierge')}</p>`
      : CLIENT_SERVICES_SIGNATURE_HTML;
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:560px">
  ${text.split(/\n+/).map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
  ${signOff}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
  <p style="font-size:12px;color:#6b7280">Sent to ${escapeHtml(recipientLabel)} at ${escapeHtml(venueName)} — reply to this email to reach the concierge team directly.</p>
</div>`;
    const result = await sendEmail({
      to: recipientEmail,
      replyTo,
      subject,
      html,
      from: { email: fromEmail, name: fromName },
    });
    if (!result.success) {
      sendError = result.error || 'Email send failed';
      return NextResponse.json({ error: sendError }, { status: 502 });
    }
    externalSent = true;
  } else {
    // sms — works for the owner or any team member with a phone on file,
    // riding the venue's own GHL/A2P connection.
    if (!venue.ghl_connected || !venue.ghl_location_id) {
      return NextResponse.json({ error: 'Venue has not connected GHL — cannot send SMS' }, { status: 400 });
    }
    const token = getGhlToken({ ghl_access_token: venue.ghl_access_token });
    if (!token) return NextResponse.json({ error: 'No GHL access token available for this venue' }, { status: 400 });
    const phoneE164 = normalizePhone(recipientPhone);
    if (!phoneE164) return NextResponse.json({ error: 'No usable phone number on file for this recipient' }, { status: 400 });

    try {
      const placeholderEmail = recipientType === 'owner'
        ? `owner.${venue.id}@storyvenue.concierge.placeholder`
        : `team.${recipientTeamMemberId}@storyvenue.concierge.placeholder`;
      const contactId = await findOrCreateContact(token, venue.ghl_location_id, {
        email: recipientEmail || placeholderEmail,
        phone: phoneE164,
        firstName: recipientLabel,
      });
      if (!contactId) return NextResponse.json({ error: 'Could not resolve a GHL contact for this recipient' }, { status: 502 });
      smsGhlContactId = contactId;
      const smsSignOff = isVenueContact
        ? (agentFirstName ? `${agentFirstName}, StoryVenue Concierge` : 'StoryVenue Concierge')
        : 'StoryVenue Client Services';
      const smsBody = `${text}\n– ${smsSignOff}`;
      await ghlSendSms(token, venue.ghl_location_id, contactId, smsBody, undefined, phoneE164);
      externalSent = true;

      // Cache the GHL contact id so the reply-tracking poller can watch for
      // a text-back without re-searching GHL every tick. Best-effort — a
      // failure here never blocks the send that already went out.
      void (async () => {
        try {
          if (recipientType === 'owner') {
            await supabaseAdmin
              .from('venues')
              .update({ owner_concierge_ghl_contact_id: contactId })
              .eq('id', venue.id);
          } else if (recipientTeamMemberId) {
            await supabaseAdmin
              .from('venue_team_members')
              .update({ concierge_ghl_contact_id: contactId })
              .eq('id', recipientTeamMemberId);
          }
        } catch (e) {
          console.warn('[private-clients/message] cache ghl contact id failed', e);
        }
      })();
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'SMS send failed';
      return NextResponse.json({ error: sendError }, { status: 502 });
    }
  }

  const { data: logRow, error: logErr } = await supabaseAdmin
    .from('private_client_messages')
    .insert({
      venue_id:                  venueId,
      recipient_type:            recipientType,
      recipient_team_member_id:  recipientTeamMemberId,
      recipient_label:           recipientLabel,
      recipient_email:           recipientEmail,
      recipient_phone:           channel === 'sms' ? recipientPhone : null,
      channel,
      body:                      text,
      direction:                 'outbound',
      ghl_contact_id:            smsGhlContactId,
      sent_by_support_user_id:   actingAgentId,
      external_sent:             externalSent,
      send_error:                sendError,
    })
    .select('id, created_at')
    .single();

  if (logErr) {
    // The message already went out — don't fail the request over a logging
    // hiccup, just surface it so it's visible in server logs.
    console.error('[private-clients/message] log insert failed', logErr);
  }

  void (async () => {
    try {
      const { broadcastPrivateClientMessage } = await import('@/lib/realtime/broadcast');
      await broadcastPrivateClientMessage({ venueId, direction: 'outbound', channel });
    } catch (e) {
      console.warn('[private-clients/message] broadcast failed', e);
    }
  })();

  return NextResponse.json({
    ok: true,
    messageId: (logRow as { id: string } | null)?.id ?? null,
    recipientLabel,
  });
}
