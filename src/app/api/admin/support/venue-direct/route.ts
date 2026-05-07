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
 *   - Broadcasts a realtime event so the support inbox + venue dashboard
 *     update without a refresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { broadcastBrideMessage, broadcastBrideMessageAdminOnly } from '@/lib/realtime/broadcast';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';
import { buildVenueDirectReplyToEmail } from '@/lib/conversations-inbound-email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHARS = 5000;

interface Body {
  threadId?:       string;
  body?:           string;
  recipientIds?:   string[];
  supportUserId?:  string;
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
}

interface VenueCustomerRow {
  customer_email:      string | null;
  customer_first_name: string | null;
  customer_last_name:  string | null;
}

interface TeamMemberRow {
  id:    string;
  name:  string | null;
  email: string | null;
  role:  string | null;
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

  const [{ data: venue }, { data: customer }, { data: agent }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, slug, email, notification_email')
      .eq('id', t.venue_id)
      .maybeSingle(),
    supabaseAdmin
      .from('venue_customers')
      .select('customer_email, customer_first_name, customer_last_name')
      .eq('id', t.venue_customer_id)
      .maybeSingle(),
    supabaseAdmin
      .from('support_team_members')
      .select('id, name, email')
      .eq('id', actingAgentId)
      .maybeSingle(),
  ]);

  const v  = (venue    ?? null) as VenueRow | null;
  const vc = (customer ?? null) as VenueCustomerRow | null;
  const a  = (agent    ?? null) as { id: string; name: string | null; email: string | null } | null;

  // Resolve recipient venue team members.
  // Default: all active members of the venue's team + the account holder
  // (the venue's billing/owner email). Caller may narrow with recipientIds
  // — when explicit, the owner is only included if their email matches an
  // explicit selection.
  let recipientQuery = supabaseAdmin
    .from('venue_team_members')
    .select('id, name, email, role')
    .eq('venue_id', t.venue_id)
    .neq('status', 'inactive');

  const explicit = Array.from(new Set((body.recipientIds ?? []).filter(Boolean)));
  if (explicit.length > 0) recipientQuery = recipientQuery.in('id', explicit);

  const { data: recipientsRaw } = await recipientQuery;
  const teamRecipients = ((recipientsRaw ?? []) as TeamMemberRow[]).filter(r => !!r.email);

  // Always also email the account holder (venue.email or notification_email)
  // unless an explicit narrowed recipient list excludes everyone.
  const ownerEmail = (v?.notification_email || v?.email || '').trim();
  const ownerIncluded = explicit.length === 0; // when not narrowed, include owner
  type EmailRecipient = { email: string; name: string | null; isOwner: boolean };
  const dedup = new Map<string, EmailRecipient>();
  for (const m of teamRecipients) {
    const key = (m.email || '').toLowerCase();
    if (key) dedup.set(key, { email: m.email!, name: m.name, isOwner: false });
  }
  if (ownerIncluded && ownerEmail) {
    const key = ownerEmail.toLowerCase();
    if (!dedup.has(key)) {
      dedup.set(key, { email: ownerEmail, name: v?.name ?? null, isOwner: true });
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
  void broadcastBrideMessage({
    inbound:                 false,
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
  // Also fire the admin-only event (with supportOnly=false + venue_direct
  // metadata) so the support inbox can update its unread/replied state.
  void broadcastBrideMessageAdminOnly({
    inbound:                 false,
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

  // Build email
  const brideName = [vc?.customer_first_name, vc?.customer_last_name].filter(Boolean).join(' ').trim() || vc?.customer_email || 'a contact';
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
  const previewSnippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;
  const replyHint = replyTo
    ? 'You can reply to this email <strong style="color:#111827;">or</strong> click the button to reply in your dashboard — either way it lands in the same thread.'
    : 'Click the button to reply in your dashboard.';

  const emailHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Message from StoryVenue Concierge</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px 28px 0;">
          <p style="margin:0;font-size:11px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:700;">StoryVenue Concierge team &middot; Venue Direct</p>
          <h1 style="margin:10px 0 4px;font-size:18px;color:#111827;font-weight:600;">${escapeHtml(fromDisplayName)} sent you a message</h1>
          <p style="margin:0;font-size:13px;color:#6b7280;">About <strong style="color:#111827;">${escapeHtml(brideName)}</strong> at ${escapeHtml(venueName)}</p>
        </td></tr>
        <tr><td style="padding:18px 28px;">
          <blockquote style="margin:0;border-left:3px solid #7c3aed;padding:10px 14px;background:#f5f3ff;color:#1f2937;white-space:pre-wrap;font-size:14px;line-height:1.55;border-radius:0 6px 6px 0;">
            ${escapeHtml(previewSnippet)}
          </blockquote>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 8px;">
          <a href="${contactUrl}" style="display:inline-block;background:#1b1b1b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View &amp; reply in dashboard</a>
        </td></tr>
        <tr><td style="padding:8px 28px 24px;">
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.55;">
            ${replyHint}
          </p>
          <p style="margin:14px 0 0;padding-top:14px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;line-height:1.55;">
            This is a private message between the StoryVenue Concierge team and your venue. The contact never sees it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Send to each unique recipient (team members + owner, deduped).
  await Promise.allSettled(
    recipients.map(r =>
      sendEmail({
        to: r.email,
        subject: `[Venue Direct] Message about ${brideName}`,
        html: emailHtml,
        replyTo,
        from: { email: fromEmail, name: 'StoryVenue Concierge team' },
        headers: { 'X-Entity-Ref-ID': `storyvenue-venue-direct-${msg.id}` },
      })
        .then(res => {
          if (!res.success) console.warn('[venue-direct] email failed', r.email, res.error);
        })
        .catch(err => console.warn('[venue-direct] email exception', r.email, err)),
    ),
  );

  return NextResponse.json({
    ok: true,
    messageId: msg.id,
    recipientsNotified: recipients.length,
    ownerIncluded: recipients.some(r => r.isOwner),
  });
}
