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
 *   }
 *
 * SMS only works for the owner today: it rides the venue's own GHL/A2P
 * connection (same as owner push/SMS notifications). Phone is resolved as
 * venues.notification_phone falling back to venues.phone.
 *
 * Auth: super admin OR support agent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms as ghlSendSms } from '@/lib/ghl';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';

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

  // Look up agent name for the outbound signature (best-effort — never crashes).
  let agentDisplayName = 'StoryVenue Concierge Team';
  {
    const { data: stmRow } = await supabaseAdmin
      .from('support_team_members')
      .select('name')
      .eq('id', actingAgentId)
      .maybeSingle();
    const n = (stmRow as { name?: string | null } | null)?.name?.trim();
    if (n) agentDisplayName = n;
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
      .select('id, name, first_name, last_name, email')
      .eq('id', teamMemberId)
      .eq('venue_id', venueId)
      .maybeSingle();
    if (!tmRow) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    const tm = tmRow as { id: string; name: string | null; first_name: string | null; last_name: string | null; email: string | null };
    recipientTeamMemberId = tm.id;
    recipientLabel = tm.name || [tm.first_name, tm.last_name].filter(Boolean).join(' ').trim() || tm.email || 'Team member';
    recipientEmail = tm.email || null;
    // SMS is owner-only — team member sends go via email only.
  }

  let externalSent = false;
  let sendError: string | null = null;

  if (channel === 'email') {
    if (!recipientEmail) {
      return NextResponse.json({ error: 'No email address on file for this recipient' }, { status: 400 });
    }
    const venueName = venue.name || 'your venue';
    const fromEmail = process.env.SUPPORT_FROM_EMAIL?.trim() || 'support@storyvenue.com';
    const replyTo = process.env.SUPPORT_REPLY_TO?.trim() || fromEmail;
    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827;max-width:560px">
  <p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:700;">StoryVenue Concierge Team</p>
  ${text.split(/\n+/).map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`).join('')}
  <p style="margin:20px 0 0">– ${escapeHtml(agentDisplayName)}<br/>StoryVenue Venue Concierge Team<br/>support@storyvenue.com</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
  <p style="font-size:12px;color:#6b7280">Sent to ${escapeHtml(recipientLabel)} at ${escapeHtml(venueName)} — reply to this email to reach the concierge team directly.</p>
</div>`;
    const result = await sendEmail({
      to: recipientEmail,
      replyTo,
      subject,
      html,
      from: { email: fromEmail, name: 'StoryVenue Concierge team' },
    });
    if (!result.success) {
      sendError = result.error || 'Email send failed';
      return NextResponse.json({ error: sendError }, { status: 502 });
    }
    externalSent = true;
  } else {
    // sms
    if (recipientType !== 'owner') {
      return NextResponse.json({ error: 'SMS is only available for the account owner' }, { status: 400 });
    }
    if (!venue.ghl_connected || !venue.ghl_location_id) {
      return NextResponse.json({ error: 'Venue has not connected GHL — cannot send SMS' }, { status: 400 });
    }
    const token = getGhlToken({ ghl_access_token: venue.ghl_access_token });
    if (!token) return NextResponse.json({ error: 'No GHL access token available for this venue' }, { status: 400 });
    const phoneE164 = normalizePhone(recipientPhone);
    if (!phoneE164) return NextResponse.json({ error: 'No usable phone number on file for this owner' }, { status: 400 });

    try {
      const contactId = await findOrCreateContact(token, venue.ghl_location_id, {
        email: recipientEmail || `owner.${venue.id}@storyvenue.concierge.placeholder`,
        phone: phoneE164,
        firstName: recipientLabel,
      });
      if (!contactId) return NextResponse.json({ error: 'Could not resolve a GHL contact for the owner' }, { status: 502 });
      const agentFirstName = agentDisplayName.split(/\s+/)[0] || agentDisplayName;
      const smsBody = `${text}\n– ${agentFirstName}, StoryVenue Concierge Team`;
      await ghlSendSms(token, venue.ghl_location_id, contactId, smsBody, undefined, phoneE164);
      externalSent = true;
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

  return NextResponse.json({
    ok: true,
    messageId: (logRow as { id: string } | null)?.id ?? null,
    recipientLabel,
  });
}
