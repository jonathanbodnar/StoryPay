/**
 * POST /api/admin/support/bride-reply
 *
 * Sends a reply to a bride on behalf of the venue. The support agent's
 * identity is taken from the current support session cookie. Super admins
 * (master admin_token) without an agent identity must pass `supportUserId`
 * explicitly so the message can be attributed.
 *
 * Body:
 *   {
 *     threadId:      string,
 *     body:          string,
 *     channel?:      'sms' | 'email',     // defaults to inbound channel
 *     internalNote?: string,
 *     supportUserId?: string,              // required when no agent session
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { sendAsVenue } from '@/lib/support/send-as-venue';
import { ensureSuperAdminSupportMember, SUPER_ADMIN_SUPPORT_USER_ID } from '@/lib/support/super-admin-member';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    threadId?:      string;
    body?:          string;
    channel?:       'sms' | 'email';
    internalNote?:  string;
    supportUserId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const threadId = (body.threadId || '').trim();
  const text     = (body.body || '').trim();
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  if (!text)     return NextResponse.json({ error: 'Empty message body' }, { status: 400 });

  // Determine support user id. Resolution order:
  //   1. Logged-in support agent session (real member).
  //   2. Explicit supportUserId in the body (super admin acting-as).
  //   3. Synthetic Super Admin support member — auto-bootstrapped so the
  //      master super admin can act with zero setup.
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
  // If the super admin's synthetic id was passed explicitly, make sure
  // the row actually exists before validating.
  if (supportUserId === SUPER_ADMIN_SUPPORT_USER_ID) {
    await ensureSuperAdminSupportMember();
  }

  // Validate the support user exists and is active
  const { data: stm } = await supabaseAdmin
    .from('support_team_members')
    .select('id, active')
    .eq('id', supportUserId)
    .maybeSingle();
  if (!stm || !(stm as { active: boolean }).active) {
    return NextResponse.json({ error: 'Support user not found or inactive' }, { status: 400 });
  }

  // Load thread to get venue + last inbound channel
  const { data: tRow } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id, external_reply_channel')
    .eq('id', threadId)
    .maybeSingle();
  const thread = tRow as {
    id: string; venue_id: string; venue_customer_id: string;
    external_reply_channel: string | null;
  } | null;
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  // Default channel = same as last inbound external message (or thread's reply channel)
  let channel: 'sms' | 'email' | undefined = body.channel;
  if (!channel) {
    const { data: lastInbound } = await supabaseAdmin
      .from('conversation_messages')
      .select('channel')
      .eq('thread_id', threadId)
      .eq('sender_kind', 'contact')
      .eq('visibility', 'external')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ch = (lastInbound as { channel?: string } | null)?.channel;
    if (ch === 'sms' || ch === 'email') channel = ch;
    else if (thread.external_reply_channel === 'sms' || thread.external_reply_channel === 'email') {
      channel = thread.external_reply_channel;
    } else {
      channel = 'sms';
    }
  }

  // Try to resolve a matching lead (best-effort) so we can log activity
  let leadId: string | null = null;
  const { data: vcRow } = await supabaseAdmin
    .from('venue_customers')
    .select('customer_email')
    .eq('id', thread.venue_customer_id)
    .maybeSingle();
  const email = ((vcRow as { customer_email?: string } | null)?.customer_email || '').trim().toLowerCase();
  if (email) {
    const { data: leadRow } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('venue_id', thread.venue_id)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    leadId = (leadRow as { id?: string } | null)?.id ?? null;
  }

  const result = await sendAsVenue({
    venueId:       thread.venue_id,
    leadId,
    body:          text,
    supportUserId,
    channel,
    threadId:      thread.id,
    internalNote:  body.internalNote,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || 'Send failed', threadId: result.threadId },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    threadId:  result.threadId,
    messageId: result.messageId,
    channel,
  });
}
