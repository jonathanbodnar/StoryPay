/**
 * POST /api/admin/support/venue-direct
 *
 * The concierge team sends a "Venue Direct" message — visible to the venue
 * staff (owner + active venue_team_members) but hidden from the bride. Used
 * to ask questions about a specific bride contact without ever logging into
 * the venue's subaccount.
 *
 * Body:
 *   {
 *     threadId:        string;   // bride conversation thread
 *     body:            string;
 *     recipientIds?:   string[]; // venue_team_members.id values; defaults to all active
 *     supportUserId?:  string;   // identity-picker fallback for super admin
 *   }
 *
 * Auth: super admin OR support agent.
 *
 * Side effects:
 *   - Inserts a conversation_messages row
 *     (audience='venue_direct', visibility='internal', sender_kind='concierge',
 *     support_only=false). The message is NEVER sent to the bride.
 *   - Emails every selected venue team member with a deep-link to the bride's
 *     contact page so they can reply in-app.
 *   - Best-effort SMS "nudge" (rides the venue's own GHL/A2P connection, same
 *     as Private Clients) to every recipient with a phone on file — short
 *     text + deep link, since busy owners check texts faster than email.
 *     This is intentionally one-way: a text-back has no reliable way to know
 *     which bride thread it's about (unlike the threaded email reply-to), so
 *     the real reply still happens via the email thread or in the dashboard.
 *   - Both the email and SMS legs are gated per-person by each recipient's
 *     own `email_venue_direct` / `sms_venue_direct` toggle inside their
 *     notification_settings jsonb (venues.notification_settings for the
 *     owner, venue_team_members.notification_settings per teammate — see
 *     src/lib/notification-settings.ts, editable from
 *     Settings -> Notifications). This is a separate toggle from AI
 *     Concierge handoff — they're different triggers with different
 *     content. The in-app message is unaffected — everyone still sees it
 *     in the thread regardless of their prefs.
 *   - Broadcasts a realtime event so the support inbox + venue dashboard
 *     update without a refresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { broadcastBrideMessage, broadcastBrideMessageAdminOnly, broadcastVenueDirectInboxUpdate } from '@/lib/realtime/broadcast';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';
import { buildVenueDirectReplyToEmail } from '@/lib/conversations-inbound-email';
import type { SupportAttachment } from '@/lib/support/support-attachments-bucket';
import { findOrCreateContact, getGhlToken, normalizePhone, sendSms as ghlSendSms } from '@/lib/ghl';
import { mergePersonNotificationSettings } from '@/lib/notification-settings';
import { notifyOwnerVenueDirectPush } from '@/lib/owner-notifications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHARS = 5000;
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

interface Body {
  threadId?:       string;
  body?:           string;
  recipientIds?:   string[];
  supportUserId?:  string;
  attachments?:    SupportAttachment[];
}

interface ThreadRow {
  id:                string;
  venue_id:          string;
  venue_customer_id: string;
}

interface VenueRow {
  id:                 string;
  name:               string | null;
  slug:               string | null;
  email:              string | null;
  notification_email: string | null;
  notification_phone: string | null;
  phone:              string | null;
  owner_id:           string | null;
  ghl_access_token:   string | null;
  ghl_location_id:    string | null;
  ghl_connected:       boolean | null;
  owner_concierge_ghl_contact_id: string | null;
  notification_settings: unknown;
}

interface VenueCustomerRow {
  customer_email: string | null;
  first_name:     string | null;
  last_name:      string | null;
  phone:          string | null;
  created_at:     string | null;
  stage_id:       string | null;
  pipeline_stage: string | null;
}

interface TeamMemberRow {
  id:    string;
  name:  string | null;
  email: string | null;
  phone: string | null;
  role:  string | null;
  notification_settings: unknown;
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

  const threadId = (body.threadId || '').trim();
  const text     = (body.body     || '').trim();
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  if (!text)     return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `Message exceeds ${MAX_CHARS} chars` }, { status: 400 });
  }
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

  // Resolve acting agent
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

  // Pull thread + venue + bride context together
  const { data: thread } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id')
    .eq('id', threadId)
    .maybeSingle();
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  const t = thread as ThreadRow;

  const [{ data: venue }, { data: customer }, { data: agent }, { data: lastBrideMsgs }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, slug, email, notification_email, notification_phone, phone, owner_id, ghl_access_token, ghl_location_id, ghl_connected, owner_concierge_ghl_contact_id, notification_settings')
      .eq('id', t.venue_id)
      .maybeSingle(),
    supabaseAdmin
      .from('venue_customers')
      .select('customer_email, first_name, last_name, phone, created_at, stage_id, pipeline_stage')
      .eq('id', t.venue_customer_id)
      .maybeSingle(),
    supabaseAdmin
      .from('support_team_members')
      .select('id, name, email')
      .eq('id', actingAgentId)
      .maybeSingle(),
    // Fetch the bride's most recent inbound message for email context
    supabaseAdmin
      .from('conversation_messages')
      .select('body, created_at')
      .eq('thread_id', threadId)
      .eq('sender_kind', 'contact')
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const v  = (venue    ?? null) as VenueRow | null;
  const vc = (customer ?? null) as VenueCustomerRow | null;
  const a  = (agent    ?? null) as { id: string; name: string | null; email: string | null } | null;
  const lastBrideMessage = ((lastBrideMsgs ?? []) as Array<{ body: string; created_at: string }>)[0] ?? null;

  // Resolve the contact's current pipeline stage label
  let stageName: string | null = null;
  if (vc?.stage_id) {
    const { data: stageRow } = await supabaseAdmin
      .from('lead_pipeline_stages')
      .select('name')
      .eq('id', vc.stage_id)
      .maybeSingle();
    stageName = (stageRow as { name: string } | null)?.name ?? null;
  }
  if (!stageName && vc?.pipeline_stage) {
    // Capitalise the legacy text slug (e.g. "inquiry" → "Inquiry")
    stageName = vc.pipeline_stage.charAt(0).toUpperCase() + vc.pipeline_stage.slice(1);
  }

  // Resolve the account owner's login email from auth.users via owner_id.
  // This is the email they use to sign in, which may differ from the business
  // notification email stored in venues.notification_email/email.
  let ownerAuthEmail: string | null = null;
  if (v?.owner_id) {
    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(v.owner_id);
      ownerAuthEmail = authUser?.user?.email?.trim() || null;
    } catch (e) {
      console.warn('[venue-direct] could not fetch owner auth email', e);
    }
  }
  // Fall back to notification_email then venues.email if auth lookup fails
  const ownerEmail = ownerAuthEmail || (v?.notification_email || v?.email || '').trim();

  // Resolve recipient venue team members.
  // Default: all active members of the venue's team + the account holder.
  // Caller may narrow with recipientIds — when explicit, the owner is only
  // included if their email matches an explicit selection.
  let recipientQuery = supabaseAdmin
    .from('venue_team_members')
    .select('id, name, email, phone, role, notification_settings')
    .eq('venue_id', t.venue_id)
    .neq('status', 'inactive');

  const explicit = Array.from(new Set((body.recipientIds ?? []).filter(Boolean)));
  if (explicit.length > 0) recipientQuery = recipientQuery.in('id', explicit);

  const { data: recipientsRaw } = await recipientQuery;
  const teamRecipients = ((recipientsRaw ?? []) as TeamMemberRow[]).filter(r => !!r.email);

  const ownerIncluded = explicit.length === 0; // when not narrowed, include owner
  type EmailRecipient = {
    email: string; name: string | null; isOwner: boolean; phone: string | null; teamMemberId: string | null;
    /** Per-person opt-out — see migration 201 + /api/profile/venue-direct-notifications.
     *  Defaults to true (existing always-on behavior) until someone explicitly flips it. */
    emailEnabled: boolean; smsEnabled: boolean;
  };
  const dedup = new Map<string, EmailRecipient>();
  for (const m of teamRecipients) {
    const key = (m.email || '').toLowerCase();
    if (key) {
      const prefs = mergePersonNotificationSettings(m.notification_settings);
      dedup.set(key, {
        email: m.email!, name: m.name, isOwner: false, phone: m.phone ?? null, teamMemberId: m.id,
        emailEnabled: prefs.email_venue_direct,
        smsEnabled:   prefs.sms_venue_direct,
      });
    }
  }
  const ownerPhone = (v?.notification_phone || v?.phone || null);
  if (ownerIncluded && ownerEmail) {
    const key = ownerEmail.toLowerCase();
    if (!dedup.has(key)) {
      const prefs = mergePersonNotificationSettings(v?.notification_settings);
      dedup.set(key, {
        email: ownerEmail, name: v?.name ?? null, isOwner: true, phone: ownerPhone, teamMemberId: null,
        emailEnabled: prefs.email_venue_direct,
        smsEnabled:   prefs.sms_venue_direct,
      });
    }
  }
  const recipients = Array.from(dedup.values());

  // Insert the message. audience='venue_direct' is the new gating field.
  // We also keep visibility='internal' so the bride-facing send path
  // (which already filters by visibility='external') never picks it up.
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      thread_id:               threadId,
      visibility:              'internal',
      channel:                 'email',
      body:                    text,
      sender_kind:             'concierge',
      sent_by_support_user_id: actingAgentId,
      sent_on_behalf_of_venue: false,
      support_only:            false,
      audience:                'venue_direct',
      external_email_sent:     true,  // we send our own email below
      ...(attachments.length ? { attachments } : {}),
    })
    .select('id, created_at')
    .single();

  if (insErr) {
    console.error('[venue-direct] insert error', insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }
  const msg = inserted as { id: string; created_at: string };

  // Realtime broadcast — fan out to admin inbox + thread + venue's conversations
  // channel so the venue's open Conversations page also picks up the new
  // venue_direct bubble in real-time without a refresh.
  // IMPORTANT: venueDirectMessage=true tells the SupportInboxPanel NOT to drop
  // the thread from "Needs Reply" — a VD message is a side-channel to the venue,
  // not a reply to the bride, so the bride alert must stay active.
  void broadcastBrideMessage({
    inbound:                 false,
    venueDirectMessage:      true,
    attachments:             attachments.length ? attachments : null,
    threadId,
    venueId:                 t.venue_id,
    venueCustomerId:         t.venue_customer_id,
    messageId:               msg.id,
    body:                    text,
    channel:                 'email',
    senderKind:              'concierge',
    sentByVenueSupport:      true,
    supportAgentId:          actingAgentId,
    createdAt:               msg.created_at,
  });
  // Also fire the admin-only event so the thread detail view updates live.
  void broadcastBrideMessageAdminOnly({
    inbound:                 false,
    venueDirectMessage:      true,
    attachments:             attachments.length ? attachments : null,
    threadId,
    venueId:                 t.venue_id,
    venueCustomerId:         t.venue_customer_id,
    messageId:               msg.id,
    body:                    text,
    channel:                 'email',
    senderKind:              'concierge',
    sentByVenueSupport:      true,
    supportAgentId:          actingAgentId,
    createdAt:               msg.created_at,
    supportOnly:             false,
    mentionedSupportUserIds: [],
  });
  // Update VenueDirectInboxView in real-time (replaces 30-second poll for this event).
  void broadcastVenueDirectInboxUpdate({ threadId, venueId: t.venue_id, direction: 'outbound' });

  // Push notification (web + native mobile app). Email/SMS are sent below with
  // per-person prefs; push is venue-wide and gated on the master push toggle.
  // sendNativePush stamps the refreshed badge (which counts unread venue_direct
  // messages), so the app icon count updates the instant the push lands.
  void notifyOwnerVenueDirectPush({ venueId: t.venue_id, venueCustomerId: t.venue_customer_id });

  // Build email
  const brideName = [vc?.first_name, vc?.last_name].filter(Boolean).join(' ').trim() || vc?.customer_email || 'a contact';
  const venueName = v?.name || 'your venue';
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const contactUrl = `${baseUrl}/dashboard/contacts/${t.venue_customer_id}?tab=concierge`;
  const fromDisplayName = a?.name
    ? `${a.name} · StoryVenue Concierge team`
    : 'StoryVenue Concierge team';
  const fromEmail = process.env.SUPPORT_FROM_EMAIL?.trim() || 'support@storyvenue.com';
  // Reply-To is the threaded venue-direct address — replies route back into
  // this same conversation thread via /api/webhooks/inbound-email.
  const replyTo = buildVenueDirectReplyToEmail(threadId, t.venue_id)
    || process.env.SUPPORT_REPLY_TO?.trim()
    || undefined;
  const replyHint = replyTo
    ? 'You can reply to this email <strong style="color:#1b1b1b;">or</strong> click the button to reply in your dashboard — either way it lands in the same thread.'
    : 'Click the button to reply in your dashboard.';

  // Contact snapshot rows
  const opportunityCreatedAt = vc?.created_at
    ? (() => {
        const d = new Date(vc.created_at);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          + ' at '
          + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      })()
    : null;

  // Always emit a Name row — fall back through first+last, email, then "Unknown"
  const contactNameForSnapshot =
    [vc?.first_name, vc?.last_name].filter(Boolean).join(' ').trim()
    || vc?.customer_email
    || 'Unknown';

  const brideInfoRows = [
    ['Name',    contactNameForSnapshot],
    ['Phone',   vc?.phone || null],
    ['Email',   vc?.customer_email || null],
    ['Created', opportunityCreatedAt],
    ['Stage',   stageName],
  ].filter(([, val]) => val) as [string, string][];

  const attachmentsListHtml = attachments.length
    ? `<p style="font-size:13px;color:#374151;margin:12px 0 0">${attachments.length} attachment(s): ${attachments
        .map((a) => `<a href="${a.url}" style="color:#1b1b1b">${escapeHtml(a.filename)}</a>`)
        .join(', ')}</p>`
    : '';

  const brideInfoHtml = brideInfoRows.length > 0 ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${brideInfoRows.map(([label, val], i) => `
      <tr style="background:${i % 2 === 0 ? '#f9fafb' : '#ffffff'};">
        <td style="padding:8px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;width:110px;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;font-size:13px;color:#111827;">${escapeHtml(val)}</td>
      </tr>`).join('')}
    </table>` : '';

  const emailHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>New Message From: StoryVenue Concierge Team</title></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">

        <!-- Logo -->
        <tr><td style="padding:36px 28px 0;text-align:center;">
          <img src="https://app.storyvenue.com/storyvenue-logo-dark.png" alt="StoryVenue" height="30" style="display:inline-block;height:30px;width:auto;">
        </td></tr>

        <!-- Heading -->
        <tr><td style="padding:20px 28px 0;text-align:center;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#1b1b1b;line-height:1.4;">StoryVenue Concierge Team</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#1b1b1b;line-height:1.4;">has sent you a message.</p>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:24px 28px 0;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>

        <!-- Bride snapshot -->
        ${brideInfoRows.length > 0 ? `<tr><td style="padding:20px 28px 0;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Contact Snapshot</p>
          ${brideInfoHtml}
        </td></tr>` : ''}

        <!-- Concierge message -->
        <tr><td style="padding:${brideInfoRows.length > 0 ? '16px' : '20px'} 28px 0;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Message from Concierge Team</p>
          <div style="border:1px solid #e5e7eb;padding:16px 20px;background:#f9f9f9;color:#1b1b1b;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;text-align:left;font-size:14px;line-height:1.7;border-radius:8px;">${escapeHtml(text)}</div>
          ${attachmentsListHtml}
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:28px 28px 0;text-align:center;">
          <a href="${contactUrl}" style="display:inline-block;background:#1b1b1b;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:14px;font-weight:600;">View &amp; reply in dashboard</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 28px 32px;">
          <p style="margin:0 0 16px;font-size:13px;color:#374151;line-height:1.55;">
            ${replyHint}
          </p>
          <div style="height:1px;background:#e5e7eb;margin-bottom:16px;"></div>
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.55;">
            This is a private message between the StoryVenue Concierge team and your venue. The contact never sees it.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  // Send to each unique recipient (team members + owner, deduped) who hasn't
  // personally turned off the Venue Direct email in their own notification
  // prefs (Settings -> Push Notifications). Everyone still sees the message
  // in-app either way.
  const emailRecipients = recipients.filter(r => r.emailEnabled);
  const emailResults = await Promise.allSettled(
    emailRecipients.map(r =>
      sendEmail({
        to: r.email,
        subject: `New Message From: StoryVenue Concierge Team`,
        html: emailHtml,
        replyTo,
        from: { email: fromEmail, name: 'StoryVenue Concierge team' },
        headers: { 'X-Entity-Ref-ID': `storyvenue-venue-direct-${msg.id}` },
        attachments: attachments.length
          ? attachments.map((a) => ({ filename: a.filename, path: a.url }))
          : undefined,
      })
        .then(res => {
          if (!res.success) console.warn('[venue-direct] email failed', r.email, res.error);
          return res;
        })
        .catch(err => {
          console.warn('[venue-direct] email exception', r.email, err);
          return { success: false } as { success: boolean; id?: string };
        }),
    ),
  );

  // Correlate delivery/read status for the Resend webhook. There's one row
  // per venue_direct message but potentially multiple recipient sends — we
  // store the first successful send's id as a best-effort correlation key.
  const firstResendId = emailResults
    .map(r => (r.status === 'fulfilled' ? r.value.id : undefined))
    .find((id): id is string => !!id);
  if (firstResendId) {
    await supabaseAdmin
      .from('conversation_messages')
      .update({ resend_email_id: firstResendId })
      .eq('id', msg.id);
  }

  // Best-effort SMS nudge — same GHL/A2P connection as Private Clients, but
  // one-way: a short text + deep link, never a two-way reply channel. A raw
  // text-back from the owner has no reliable way to say "which bride thread
  // is this about", so the actual reply still happens via the threaded email
  // (replyTo above) or in the dashboard. Never blocks the response — a
  // missing/invalid phone or a disconnected GHL location just means no text.
  const ghlToken = getGhlToken({ ghl_access_token: v?.ghl_access_token ?? null });
  let smsNotified = 0;
  if (v?.ghl_connected && v?.ghl_location_id && ghlToken) {
    const smsBody = 'You have a new message from the StoryVenue Concierge team. Please check your email, app or dashboard for details.';
    const smsResults = await Promise.allSettled(
      recipients
        .filter(r => !!r.phone && r.smsEnabled)
        .map(async r => {
          const phoneE164 = normalizePhone(r.phone);
          if (!phoneE164) return;
          const placeholderEmail = r.isOwner
            ? `owner.${v.id}@storyvenue.concierge.placeholder`
            : `team.${r.teamMemberId}@storyvenue.concierge.placeholder`;
          const contactId = await findOrCreateContact(ghlToken, v.ghl_location_id!, {
            email: r.email || placeholderEmail,
            phone: phoneE164,
            firstName: r.name || undefined,
          });
          if (!contactId) return;
          await ghlSendSms(ghlToken, v.ghl_location_id!, contactId, smsBody, undefined, phoneE164);
          smsNotified += 1;
          // Cache the GHL contact id so the existing concierge SMS reply
          // poller (src/lib/concierge-sms-sync.ts) can pick up a text-back,
          // same as Private Clients — best-effort, never blocks the send.
          if (r.isOwner) {
            await supabaseAdmin.from('venues').update({ owner_concierge_ghl_contact_id: contactId }).eq('id', v.id);
          } else if (r.teamMemberId) {
            await supabaseAdmin.from('venue_team_members').update({ concierge_ghl_contact_id: contactId }).eq('id', r.teamMemberId);
          }
        }),
    );
    for (const res of smsResults) {
      if (res.status === 'rejected') console.warn('[venue-direct] sms nudge failed', res.reason);
    }
  }

  return NextResponse.json({
    ok: true,
    messageId: msg.id,
    recipientsNotified: recipients.length,
    emailNotified: emailRecipients.length,
    smsNotified,
    ownerIncluded: recipients.some(r => r.isOwner),
  });
}
