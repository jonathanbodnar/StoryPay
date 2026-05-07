/**
 * GET /api/admin/support/bride-thread/[threadId]
 *
 * Returns full message history + venue/lead context for a single conversation
 * thread. Super-admin or support-agent only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ThreadRow {
  id:                     string;
  venue_id:               string;
  venue_customer_id:      string;
  subject:                string;
  last_message_at:        string;
  last_message_preview:   string | null;
  last_message_visibility: string | null;
  external_reply_channel: string | null;
}

interface VenueRow {
  id:                  string;
  name:                string;
  notification_email:  string | null;
  ai_concierge_notify_emails: string[] | null;
  timezone:            string | null;
}

interface CustomerRow {
  id:             string;
  customer_email: string | null;
  first_name:     string | null;
  last_name:      string | null;
  phone:          string | null;
}

interface MessageRow {
  id:                          string;
  thread_id:                   string;
  visibility:                  'internal' | 'external';
  channel:                     'email' | 'sms';
  body:                        string;
  sender_kind:                 'owner' | 'team' | 'contact' | 'system' | 'ai' | 'concierge';
  venue_team_member_id:        string | null;
  contact_from_name:           string | null;
  contact_from_email:          string | null;
  external_email_sent:         boolean | null;
  send_error:                  string | null;
  sent_by_support_user_id:     string | null;
  sent_on_behalf_of_venue:     boolean | null;
  support_internal_note:       string | null;
  support_only:                boolean | null;
  audience:                    'external' | 'support_only' | 'venue_direct' | null;
  mentioned_support_user_ids:  string[] | null;
  created_at:                  string;
}

interface LeadRow {
  id:         string;
  name:       string | null;
  first_name: string | null;
  last_name:  string | null;
  email:      string | null;
  phone:      string | null;
  status:     string | null;
  pipeline_stage_id: string | null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ threadId: string }> },
) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { threadId } = await ctx.params;
  if (!threadId) {
    return NextResponse.json({ error: 'Missing thread id' }, { status: 400 });
  }

  const { data: tRow, error: tErr } = await supabaseAdmin
    .from('conversation_threads')
    .select('id, venue_id, venue_customer_id, subject, last_message_at, last_message_preview, last_message_visibility, external_reply_channel')
    .eq('id', threadId)
    .maybeSingle();

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  const thread = tRow as ThreadRow | null;
  if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

  // Cross-channel thread merging: pull all sibling threads for this bride
  // (same venue + venue_customer_id, e.g. one SMS thread + one email thread)
  // and return a merged chronological message stream so the agent sees the
  // full conversation across channels in one place.
  const [{ data: venueRow }, { data: vcRow }, { data: siblingThreads }] = await Promise.all([
    supabaseAdmin
      .from('venues')
      .select('id, name, notification_email, ai_concierge_notify_emails, timezone')
      .eq('id', thread.venue_id)
      .maybeSingle(),
    supabaseAdmin
      .from('venue_customers')
      .select('id, customer_email, first_name, last_name, phone')
      .eq('id', thread.venue_customer_id)
      .maybeSingle(),
    supabaseAdmin
      .from('conversation_threads')
      .select('id, subject, last_message_at, external_reply_channel')
      .eq('venue_id', thread.venue_id)
      .eq('venue_customer_id', thread.venue_customer_id),
  ]);

  const allThreadIds = ((siblingThreads ?? []) as Array<{ id: string }>).map(s => s.id);
  // Always include the active thread even if for some reason the venue_customer
  // join missed it (data integrity safety net).
  if (!allThreadIds.includes(threadId)) allThreadIds.push(threadId);

  const { data: msgs } = await supabaseAdmin
    .from('conversation_messages')
    .select(`
      id, thread_id, visibility, channel, body, sender_kind, venue_team_member_id,
      contact_from_name, contact_from_email, external_email_sent, send_error,
      sent_by_support_user_id, sent_on_behalf_of_venue, support_internal_note,
      support_only, audience, mentioned_support_user_ids, created_at
    `)
    .in('thread_id', allThreadIds)
    .order('created_at', { ascending: true });

  const venue    = venueRow as VenueRow | null;
  const customer = vcRow as CustomerRow | null;
  const messages = (msgs as MessageRow[]) || [];

  const siblings = ((siblingThreads ?? []) as Array<{ id: string; subject: string | null; last_message_at: string; external_reply_channel: string | null }>)
    .filter(s => s.id !== threadId)
    .map(s => ({
      id:                       s.id,
      subject:                  s.subject ?? '',
      last_message_at:          s.last_message_at,
      external_reply_channel:   s.external_reply_channel ?? null,
    }));

  // Try to resolve a matching lead by venue + customer email (best-effort)
  let lead: LeadRow | null = null;
  const email = (customer?.customer_email || '').trim().toLowerCase();
  if (email) {
    const { data: leadRow } = await supabaseAdmin
      .from('leads')
      .select('id, name, first_name, last_name, email, phone, status, pipeline_stage_id')
      .eq('venue_id', thread.venue_id)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    lead = leadRow as LeadRow | null;
  }

  // Resolve support user names referenced in messages — both authors AND
  // anyone mentioned in a support-only note.
  const supportUserIds = Array.from(new Set([
    ...messages.map(m => m.sent_by_support_user_id).filter((x): x is string => Boolean(x)),
    ...messages.flatMap(m => m.mentioned_support_user_ids || []).filter(Boolean),
  ]));
  let supportUsers: Record<string, { id: string; name: string; email: string }> = {};
  if (supportUserIds.length > 0) {
    const { data: stm } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name, email')
      .in('id', supportUserIds);
    supportUsers = Object.fromEntries((stm || []).map(r => [r.id as string, r as never]));
  }

  return NextResponse.json({
    thread,
    venue,
    customer,
    lead,
    messages,
    supportUsers,
    /** Other conversation_threads belonging to the same bride (different
     *  channels). UI uses this to render a "merged from N channels" banner
     *  and subscribe to realtime broadcasts from each sibling. */
    siblings,
  });
}
