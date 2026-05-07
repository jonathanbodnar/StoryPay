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
import { broadcastBrideMessageAdminOnly } from '@/lib/realtime/broadcast';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';

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
  id:    string;
  name:  string | null;
  slug:  string | null;
  email: string | null;
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
      .select('id, name, slug, email')
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
  // Default: all active members of the venue's team. Caller may narrow with recipientIds.
  let recipientQuery = supabaseAdmin
    .from('venue_team_members')
    .select('id, name, email, role')
    .eq('venue_id', t.venue_id)
    .neq('status', 'inactive');

  const explicit = Array.from(new Set((body.recipientIds ?? []).filter(Boolean)));
  if (explicit.length > 0) recipientQuery = recipientQuery.in('id', explicit);

  const { data: recipientsRaw } = await recipientQuery;
  const recipients = ((recipientsRaw ?? []) as TeamMemberRow[]).filter(r => !!r.email);

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

  // Realtime broadcast (admin-only channel — venue's conversations channel
  // gets fanned out from a dedicated venue-side realtime broadcast below).
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

  // Send email to each recipient. Failures don't fail the API call.
  const brideName = [vc?.customer_first_name, vc?.customer_last_name].filter(Boolean).join(' ').trim() || vc?.customer_email || 'a contact';
  const venueName = v?.name || 'your venue';
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.storyvenue.com').replace(/\/+$/, '');
  const contactUrl = `${baseUrl}/dashboard/contacts/${t.venue_customer_id}?tab=concierge`;
  const fromName  = a?.name ? `${a.name} (StoryVenue Support)` : 'StoryVenue Support';
  const fromEmail = process.env.SUPPORT_FROM_EMAIL?.trim() || 'support@storyvenue.com';
  const replyTo   = process.env.SUPPORT_REPLY_TO?.trim() || 'hello@storyvenue.com';
  const previewSnippet = text.length > 280 ? `${text.slice(0, 280)}…` : text;

  const emailHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Message from StoryVenue Support</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:24px 28px 0;">
          <p style="margin:0;font-size:11px;letter-spacing:1.5px;color:#7c3aed;text-transform:uppercase;font-weight:700;">StoryVenue Support &middot; Venue Direct</p>
          <h1 style="margin:10px 0 4px;font-size:18px;color:#111827;font-weight:600;">${escapeHtml(fromName)} sent you a message</h1>
          <p style="margin:0;font-size:13px;color:#6b7280;">About <strong style="color:#111827;">${escapeHtml(brideName)}</strong> at ${escapeHtml(venueName)}</p>
        </td></tr>
        <tr><td style="padding:18px 28px;">
          <blockquote style="margin:0;border-left:3px solid #7c3aed;padding:10px 14px;background:#f5f3ff;color:#1f2937;white-space:pre-wrap;font-size:14px;line-height:1.55;border-radius:0 6px 6px 0;">
            ${escapeHtml(previewSnippet)}
          </blockquote>
        </td></tr>
        <tr><td align="center" style="padding:0 28px 28px;">
          <a href="${contactUrl}" style="display:inline-block;background:#1b1b1b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">View &amp; reply in dashboard</a>
        </td></tr>
        <tr><td style="padding:0 28px 24px;border-top:1px solid #f3f4f6;">
          <p style="margin:14px 0 0;font-size:12px;color:#9ca3af;line-height:1.55;">
            This is a private message between StoryVenue Support and your venue team. The bride does not see it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  await Promise.allSettled(
    recipients.map(r =>
      sendEmail({
        to: r.email!,
        subject: `[Venue Direct] Message about ${brideName}`,
        html: emailHtml,
        replyTo,
        from: { email: fromEmail, name: fromName },
        headers: { 'X-Entity-Ref-ID': `storyvenue-venue-direct-${msg.id}` },
      })
        .then(res => {
          if (!res.success) console.warn('[venue-direct] email failed', r.email, res.error);
        })
        .catch(err => console.warn('[venue-direct] email exception', r.email, err)),
    ),
  );

  // Also CC the venue's billing email if no team members exist yet
  if (recipients.length === 0 && v?.email) {
    await sendEmail({
      to: v.email,
      subject: `[Venue Direct] Message about ${brideName}`,
      html: emailHtml,
      replyTo,
      from: { email: fromEmail, name: fromName },
      headers: { 'X-Entity-Ref-ID': `storyvenue-venue-direct-${msg.id}` },
    }).catch(err => console.warn('[venue-direct] fallback email exception', err));
  }

  return NextResponse.json({
    ok: true,
    messageId: msg.id,
    recipientsNotified: recipients.length,
  });
}
