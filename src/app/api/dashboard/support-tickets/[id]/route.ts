/**
 * Venue-side single-ticket endpoints.
 *
 *   GET  /api/dashboard/support-tickets/[id]        ticket + message history
 *   POST /api/dashboard/support-tickets/[id]        append a venue reply
 *                                                    (also flips status to 'open')
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveVenueAttribution } from '@/lib/support/venue-attribution';
import { broadcastTicketMessage, broadcastTicketStatus } from '@/lib/realtime/broadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ThreadRow {
  id:                       string;
  venue_id:                 string;
  subject:                  string;
  status:                   'open' | 'pending' | 'closed';
  priority:                 'low' | 'normal' | 'high';
  assigned_support_user_id: string | null;
  last_message_at:          string;
  last_message_preview:     string | null;
  created_at:               string;
  updated_at:               string;
}

interface MessageRow {
  id:                     string;
  sender_type:            'venue' | 'support';
  sender_profile_id:      string | null;
  sender_member_id:       string | null;
  sender_support_user_id: string | null;
  body:                   string;
  attachments:            unknown;
  created_at:             string;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const attr = await resolveVenueAttribution();
  if ('error' in attr) {
    return NextResponse.json({ error: attr.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });

  const { data: tRow } = await supabaseAdmin
    .from('support_threads')
    .select('id, venue_id, subject, status, priority, assigned_support_user_id, last_message_at, last_message_preview, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  const ticket = tRow as ThreadRow | null;
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (ticket.venue_id !== attr.venueId) {
    return NextResponse.json({ error: 'Ticket does not belong to this venue' }, { status: 403 });
  }

  const { data: msgs } = await supabaseAdmin
    .from('support_thread_messages')
    .select('id, sender_type, sender_profile_id, sender_member_id, sender_support_user_id, body, attachments, created_at')
    .eq('support_thread_id', id)
    .order('created_at', { ascending: true });

  const messages = (msgs as MessageRow[]) || [];

  // Resolve sender labels (support agents + members) to render names safely
  const supportIds = Array.from(new Set(messages.map(m => m.sender_support_user_id).filter((x): x is string => Boolean(x))));
  const memberIds  = Array.from(new Set(messages.map(m => m.sender_member_id).filter((x): x is string => Boolean(x))));

  const [support, members] = await Promise.all([
    supportIds.length
      ? supabaseAdmin.from('support_team_members').select('id, name').in('id', supportIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    memberIds.length
      ? supabaseAdmin.from('venue_team_members').select('id, first_name, last_name, email').in('id', memberIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null; email: string | null }[] }),
  ]);

  const supportNames = Object.fromEntries((support.data || []).map(s => [s.id, s.name as string]));
  const memberNames  = Object.fromEntries(
    (members.data || []).map(m => [
      m.id,
      [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email || 'Team member',
    ]),
  );

  return NextResponse.json({
    ticket,
    messages,
    senders: { support: supportNames, members: memberNames },
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const attr = await resolveVenueAttribution();
  if ('error' in attr) {
    return NextResponse.json({ error: attr.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });

  let body: { body?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const text = (body.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Empty message body' }, { status: 400 });

  const { data: tRow } = await supabaseAdmin
    .from('support_threads')
    .select('id, venue_id, status')
    .eq('id', id)
    .maybeSingle();
  const ticket = tRow as { id: string; venue_id: string; status: string } | null;
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (ticket.venue_id !== attr.venueId) {
    return NextResponse.json({ error: 'Ticket does not belong to this venue' }, { status: 403 });
  }

  const replyInsert: Record<string, unknown> = {
    support_thread_id: id,
    sender_type:       'venue',
    sender_profile_id: attr.profileId,
    body:              text,
  };
  if (attr.memberId) replyInsert.sender_member_id = attr.memberId;

  const { data: msg, error: mErr } = await supabaseAdmin
    .from('support_thread_messages')
    .insert(replyInsert)
    .select('id, created_at')
    .single();

  if (mErr || !msg) {
    return NextResponse.json({ error: mErr?.message || 'Failed to insert message' }, { status: 500 });
  }

  // Bump status back to 'open' (awaiting support response) unless closed.
  let nextStatus: 'open' | 'pending' | 'closed' = ticket.status as 'open' | 'pending' | 'closed';
  if (ticket.status !== 'closed' && ticket.status !== 'open') {
    await supabaseAdmin
      .from('support_threads')
      .update({ status: 'open' })
      .eq('id', id);
    nextStatus = 'open';
  }

  void broadcastTicketMessage({
    ticketId:   id,
    venueId:    attr.venueId,
    messageId:  (msg as { id: string }).id,
    senderType: 'venue',
    body:       text,
    createdAt:  (msg as { created_at?: string }).created_at || new Date().toISOString(),
    status:     nextStatus,
  });

  return NextResponse.json({ ok: true, messageId: (msg as { id: string }).id });
}

/**
 * PATCH — venue can close (or reopen) their own ticket.
 * Body: { status: 'open' | 'closed' }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const attr = await resolveVenueAttribution();
  if ('error' in attr) {
    return NextResponse.json({ error: attr.error }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });

  let body: { status?: 'open' | 'closed' };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const status = body.status === 'closed' ? 'closed' : body.status === 'open' ? 'open' : null;
  if (!status) return NextResponse.json({ error: 'status must be open or closed' }, { status: 400 });

  const { data: tRow } = await supabaseAdmin
    .from('support_threads')
    .select('id, venue_id, priority, assigned_support_user_id')
    .eq('id', id)
    .maybeSingle();
  const ticket = tRow as { id: string; venue_id: string; priority: 'low' | 'normal' | 'high'; assigned_support_user_id: string | null } | null;
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  if (ticket.venue_id !== attr.venueId) {
    return NextResponse.json({ error: 'Ticket does not belong to this venue' }, { status: 403 });
  }

  const { error: updErr } = await supabaseAdmin
    .from('support_threads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  void broadcastTicketStatus({
    ticketId:              id,
    venueId:               attr.venueId,
    status,
    priority:              ticket.priority,
    assignedSupportUserId: ticket.assigned_support_user_id,
  });

  return NextResponse.json({ ok: true, status });
}
