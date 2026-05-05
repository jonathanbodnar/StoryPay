/**
 * POST /api/admin/support/bride-note
 *
 * Saves an internal "support team only" note attached to a bride conversation
 * thread. Notes are NEVER sent to the bride or shown in the venue's inbox.
 *
 * Body:
 *   {
 *     threadId:                 string;
 *     body:                     string;
 *     mentionedSupportUserIds?: string[];   // support_team_members.id values
 *     supportUserId?:           string;     // identity-picker fallback for super admin
 *   }
 *
 * Auth: super admin OR support agent. The acting agent's id is recorded on the
 * row via `sent_by_support_user_id` so we know who wrote it.
 *
 * Side effects:
 *   - Inserts a conversation_messages row (visibility='internal',
 *     support_only=true, sender_kind='concierge', sent_on_behalf_of_venue=false).
 *   - Sends an email notification to each mentioned support team member.
 *   - Broadcasts a realtime event so the admin support inbox can render the
 *     note instantly without a refresh.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendEmail } from '@/lib/email';
import { broadcastBrideMessageAdminOnly } from '@/lib/realtime/broadcast';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NOTE_MAX_CHARS = 4000;

export async function POST(req: NextRequest) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    threadId?:                 string;
    body?:                     string;
    mentionedSupportUserIds?:  string[];
    supportUserId?:            string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const threadId = (body.threadId || '').trim();
  const text     = (body.body || '').trim();
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  if (!text)     return NextResponse.json({ error: 'body required' }, { status: 400 });
  if (text.length > NOTE_MAX_CHARS) {
    return NextResponse.json({ error: `Note exceeds ${NOTE_MAX_CHARS} chars` }, { status: 400 });
  }

  // Acting agent — resolution order:
  //   1. Logged-in support agent session.
  //   2. Explicit supportUserId in the body.
  //   3. Synthetic Super Admin (auto-bootstrapped) when isSuperAdmin.
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

  // Validate the acting agent + thread exist
  const [{ data: thread }, { data: actingAgent }] = await Promise.all([
    supabaseAdmin
      .from('conversation_threads')
      .select('id, venue_id, venue_customer_id')
      .eq('id', threadId)
      .maybeSingle(),
    supabaseAdmin
      .from('support_team_members')
      .select('id, name, email, active')
      .eq('id', actingAgentId)
      .maybeSingle(),
  ]);

  if (!thread)       return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  if (!actingAgent || !(actingAgent as { active: boolean }).active) {
    return NextResponse.json({ error: 'Support identity is not active' }, { status: 400 });
  }

  // Validate mention targets — must be active support_team_members
  const mentionIds = Array.from(new Set((body.mentionedSupportUserIds ?? []).filter(Boolean)));
  let mentions: Array<{ id: string; name: string; email: string }> = [];
  if (mentionIds.length > 0) {
    const { data: m } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name, email, active')
      .in('id', mentionIds)
      .eq('active', true);
    mentions = ((m ?? []) as Array<{ id: string; name: string; email: string }>);
  }

  // Insert the note
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('conversation_messages')
    .insert({
      thread_id:                  threadId,
      visibility:                 'internal',
      channel:                    'email',                  // arbitrary; UI ignores for notes
      body:                       text,
      sender_kind:                'concierge',
      sent_by_support_user_id:    actingAgentId,
      sent_on_behalf_of_venue:    false,
      support_only:               true,
      mentioned_support_user_ids: mentions.map(m => m.id),
      external_email_sent:        false,
    })
    .select('id, created_at')
    .single();

  if (insErr) {
    console.error('[support-note] insert', insErr);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const t = thread as { id: string; venue_id: string; venue_customer_id: string };

  // Realtime broadcast — admin inbox / active thread view appends instantly.
  // We use the admin-only variant: support_only notes must NEVER fan out to
  // the venue's conversations channel.
  void broadcastBrideMessageAdminOnly({
    inbound:                 false,
    threadId,
    venueId:                 t.venue_id,
    venueCustomerId:         t.venue_customer_id,
    messageId:               (inserted as { id: string }).id,
    body:                    text,
    channel:                 'email',
    senderKind:              'concierge',
    sentByVenueSupport:      true,
    supportAgentId:          actingAgentId,
    createdAt:               (inserted as { created_at?: string }).created_at || new Date().toISOString(),
    supportOnly:             true,
    mentionedSupportUserIds: mentions.map(m => m.id),
  });

  // Email notify mentioned agents (best effort, fan-out)
  if (mentions.length > 0) {
    const agentName = (actingAgent as { name: string }).name || 'A teammate';
    const previewSnippet = text.length > 220 ? `${text.slice(0, 220)}…` : text;
    const inboxUrl = `${(process.env.NEXT_PUBLIC_APP_URL || 'https://storypay.io').replace(/\/$/, '')}/admin?tab=support&thread=${encodeURIComponent(threadId)}`;

    await Promise.allSettled(
      mentions.map(m => {
        if (!m.email) return Promise.resolve();
        return sendEmail({
          to: m.email,
          subject: `[Support note] ${agentName} mentioned you`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px;">
              <p style="font-size: 14px; color: #374151;">
                <strong>${escapeHtml(agentName)}</strong> mentioned you in an internal support note.
              </p>
              <blockquote style="border-left: 4px solid #f59e0b; padding: 8px 12px; background: #fffbeb; color: #1f2937; margin: 16px 0; white-space: pre-wrap;">
                ${escapeHtml(previewSnippet)}
              </blockquote>
              <p>
                <a href="${inboxUrl}" style="display: inline-block; background: #1b1b1b; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open in support inbox</a>
              </p>
              <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">
                This note is internal — the venue and bride never see it.
              </p>
            </div>
          `,
        }).catch(e => console.warn('[support-note] mention email failed', m.email, e));
      }),
    );
  }

  return NextResponse.json({ ok: true, messageId: (inserted as { id: string }).id });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
