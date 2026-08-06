/**
 * POST /api/admin/support/tickets/[id]/reply
 *
 * Appends a support-agent reply to a support ticket. Auto-bumps status from
 * 'open' → 'pending' (waiting on venue) unless the caller passes status='open'.
 * Also emails the reply to the client via Resend — From: support@storyvenue.com,
 * Reply-To: the signed ticket+{id}+{sig}@{inbound domain} address so a client
 * reply routes back into this exact ticket. The email includes the replying
 * agent's name as a signature (Venue Support tickets only — never on
 * bride-facing sends).
 *
 * Body:
 *   { body: string, supportUserId?: string, status?: 'open'|'pending'|'closed' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { broadcastTicketMessage } from '@/lib/realtime/broadcast';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';
import { buildTicketReplyToEmail } from '@/lib/support/ticket-inbound-email';
import type { SupportAttachment } from '@/lib/support/support-attachments-bucket';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPPORT_FROM_EMAIL = 'support@storyvenue.com';
const SUPPORT_FROM_NAME  = 'StoryVenue Support';
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolve the client-facing email address for a Venue Support ticket:
 *   1. contact_email — set for tickets created via the inbound-email path
 *      (matched or unmatched senders both carry it).
 *   2. opened_by_member_id → venue_team_members.email — dashboard ticket
 *      opened by a team member.
 *   3. venue_id → venues.email — dashboard ticket opened by the venue owner
 *      (mirrors the same fallback used by GET .../tickets/[id] for `opener`).
 */
async function resolveTicketRecipientEmail(ticket: {
  contact_email:       string | null;
  venue_id:            string | null;
  opened_by_member_id: string | null;
}): Promise<string | null> {
  if (ticket.contact_email?.trim()) return ticket.contact_email.trim();

  if (ticket.opened_by_member_id) {
    const { data: m } = await supabaseAdmin
      .from('venue_team_members')
      .select('email')
      .eq('id', ticket.opened_by_member_id)
      .maybeSingle();
    const email = (m as { email?: string | null } | null)?.email?.trim();
    if (email) return email;
  }

  if (ticket.venue_id) {
    const { data: v } = await supabaseAdmin
      .from('venues')
      .select('email')
      .eq('id', ticket.venue_id)
      .maybeSingle();
    const email = (v as { email?: string | null } | null)?.email?.trim();
    if (email) return email;
  }

  return null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: ticketId } = await ctx.params;
  if (!ticketId) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });

  let body: {
    body?:          string;
    /** Optional pre-rendered HTML for the outbound email (rich-text composer
     *  toolbar output) — falls back to auto paragraph-split plain text below
     *  when omitted, so older/other callers keep working unchanged. */
    bodyHtml?:      string;
    supportUserId?: string;
    status?:        'open' | 'pending' | 'closed';
    attachments?:   SupportAttachment[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = (body.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Empty message body' }, { status: 400 });
  const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE);

  // Resolve support user id with the same fallback as bride-reply: real
  // agent session → explicit body id → synthetic Super Admin (auto-created).
  let supportUserId = agent?.sub || (body.supportUserId || '').trim();
  if (!supportUserId && isSuperAdmin) {
    const sa = await ensureSuperAdminSupportMember();
    supportUserId = sa.id;
  }
  if (!supportUserId) {
    return NextResponse.json(
      { error: 'Sign in as a support agent or pass supportUserId.' },
      { status: 400 },
    );
  }
  if (supportUserId === SUPER_ADMIN_SUPPORT_USER_ID) {
    await ensureSuperAdminSupportMember();
  }

  // Validate the support user exists
  const { data: stm } = await supabaseAdmin
    .from('support_team_members')
    .select('id, name, active')
    .eq('id', supportUserId)
    .maybeSingle();
  if (!stm || !(stm as { active: boolean }).active) {
    return NextResponse.json({ error: 'Support user not found or inactive' }, { status: 400 });
  }
  const agentName = (stm as { name?: string }).name?.trim() || 'StoryVenue Support';

  // Ensure the ticket exists
  const { data: ticketRow } = await supabaseAdmin
    .from('support_threads')
    .select('id, status, subject, venue_id, contact_email, opened_by_member_id')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticketRow) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  // Insert message
  const insertRow: Record<string, unknown> = {
    support_thread_id:      ticketId,
    sender_type:            'support',
    sender_support_user_id: supportUserId,
    body:                   text,
  };
  if (attachments.length) {
    insertRow.attachments = attachments;
  }

  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('support_thread_messages')
    .insert(insertRow)
    .select('id, created_at')
    .single();

  if (msgErr || !msg) {
    return NextResponse.json(
      { error: msgErr?.message || 'Failed to insert message' },
      { status: 500 },
    );
  }

  // Auto-bump status to 'pending' (awaiting venue response) unless caller
  // explicitly chose another status, or ticket was closed (leave as-is).
  const ticketStatus = (ticketRow as { status: string }).status;
  let nextStatus: 'open' | 'pending' | 'closed' | null = null;
  if (body.status === 'open' || body.status === 'pending' || body.status === 'closed') {
    nextStatus = body.status;
  } else if (ticketStatus !== 'closed' && ticketStatus !== 'pending') {
    nextStatus = 'pending';
  }

  if (nextStatus && nextStatus !== ticketStatus) {
    await supabaseAdmin
      .from('support_threads')
      .update({ status: nextStatus })
      .eq('id', ticketId);
  }

  // If the ticket has no assignee yet, claim it for the replying agent.
  await supabaseAdmin
    .from('support_threads')
    .update({ assigned_support_user_id: supportUserId })
    .eq('id', ticketId)
    .is('assigned_support_user_id', null);

  // Look up venue_id for the broadcast scope
  const { data: tFull } = await supabaseAdmin
    .from('support_threads')
    .select('venue_id, status')
    .eq('id', ticketId)
    .maybeSingle();

  const venueIdForCast = (tFull as { venue_id?: string } | null)?.venue_id || '';
  const finalStatus = (nextStatus ?? ticketStatus) as 'open' | 'pending' | 'closed';

  if (venueIdForCast) {
    void broadcastTicketMessage({
      ticketId,
      venueId:    venueIdForCast,
      messageId:  (msg as { id: string }).id,
      senderType: 'support',
      body:       text,
      createdAt:  (msg as { created_at?: string }).created_at || new Date().toISOString(),
      status:     finalStatus,
    });
  }

  // Email the reply to the client — the only outbound channel Venue Support
  // tickets had until now was "in-app". From: support@storyvenue.com,
  // Reply-To: the signed ticket+{id}+{sig} address so a client reply routes
  // back into this exact ticket instead of the (mailbox-less) Workspace
  // Group. Never blocks the API response — failures are recorded on the
  // message row and logged (sendEmail already logs to the platform error log).
  void (async () => {
    const ticketFull = ticketRow as {
      subject: string;
      venue_id: string | null;
      contact_email: string | null;
      opened_by_member_id: string | null;
    };
    const to = await resolveTicketRecipientEmail(ticketFull);
    if (!to) {
      console.warn('[tickets/reply] no recipient email resolved — skipping outbound email', { ticketId });
      return;
    }

    const replyTo = buildTicketReplyToEmail(ticketId) || undefined;
    if (!replyTo) {
      console.warn(
        '[tickets/reply] CONVERSATIONS_INBOUND_SECRET/DOMAIN not set — sending without a reply-routing address',
      );
    }

    const subjectBase = ticketFull.subject || 'Support request';
    const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;

    const attachmentsListHtml = attachments.length
      ? `<p style="font-size:13px;color:#374151;margin:12px 0 0">${attachments.length} attachment(s): ${attachments
          .map((a) => `<a href="${a.url}" style="color:#1b1b1b">${escapeHtml(a.filename)}</a>`)
          .join(', ')}</p>`
      : '';

    const bodyHtmlContent = body.bodyHtml?.trim()
      ? body.bodyHtml
      : escapeHtml(text)
          .split(/\n+/)
          .map((p) => `<p style="margin:0 0 12px">${p}</p>`)
          .join('');

    const html = `
<div style="font-family:'Open Sans',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111827">
${bodyHtmlContent}
${attachmentsListHtml}
<p style="margin:20px 0 0">Thanks,<br/>${escapeHtml(agentName)}<br/>StoryVenue Support</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
<p style="font-size:12px;color:#6b7280">Reply to this email to continue this conversation with our support team.</p>
</div>`;

    const result = await sendEmail({
      to,
      replyTo,
      subject,
      html,
      from: { name: SUPPORT_FROM_NAME, email: SUPPORT_FROM_EMAIL },
      attachments: attachments.length
        ? attachments.map((a) => ({ filename: a.filename, path: a.url }))
        : undefined,
    });

    await supabaseAdmin
      .from('support_thread_messages')
      .update({
        external_email_sent: result.success,
        send_error: result.error ?? null,
        ...(result.id ? { resend_email_id: result.id } : {}),
      })
      .eq('id', (msg as { id: string }).id);

    if (!result.success) {
      console.warn('[tickets/reply] outbound client email failed:', result.error, { ticketId });
    }
  })().catch((e) => console.warn('[tickets/reply] outbound email pipeline failed', e));

  return NextResponse.json({
    ok: true,
    messageId: (msg as { id: string }).id,
    status:    finalStatus,
  });
}
