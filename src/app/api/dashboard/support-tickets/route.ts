/**
 * Venue-side support ticket endpoints.
 *
 *   GET  /api/dashboard/support-tickets        list this venue's tickets
 *   POST /api/dashboard/support-tickets        open a new ticket
 *
 * Both endpoints use the existing venue_id / member_id cookie scheme via
 * resolveVenueAttribution() — no Supabase session required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveVenueAttribution } from '@/lib/support/venue-attribution';
import { broadcastTicketMessage } from '@/lib/realtime/broadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const attr = await resolveVenueAttribution();
  if ('error' in attr) {
    return NextResponse.json({ error: attr.error }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('support_threads')
    .select(`
      id, subject, status, priority, last_message_at, last_message_preview,
      created_at, updated_at, assigned_support_user_id
    `)
    .eq('venue_id', attr.venueId)
    .order('last_message_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickets = data ?? [];
  const threadIds = tickets.map((t: { id: string }) => t.id);

  // Fetch the last message sender_type per thread so the client can determine
  // which tickets have an unread support reply.
  let lastSenderByThread: Record<string, 'venue' | 'support'> = {};
  if (threadIds.length > 0) {
    const { data: msgRows } = await supabaseAdmin
      .from('support_thread_messages')
      .select('support_thread_id, sender_type, created_at')
      .in('support_thread_id', threadIds)
      .order('created_at', { ascending: false });

    for (const row of (msgRows ?? []) as Array<{ support_thread_id: string; sender_type: string }>) {
      if (!lastSenderByThread[row.support_thread_id]) {
        lastSenderByThread[row.support_thread_id] =
          row.sender_type === 'support' ? 'support' : 'venue';
      }
    }
  }

  const enriched = tickets.map((t: { id: string }) => ({
    ...t,
    last_sender_type: lastSenderByThread[t.id] ?? 'venue',
  }));

  return NextResponse.json({ tickets: enriched, venueId: attr.venueId });
}

export async function POST(req: NextRequest) {
  const attr = await resolveVenueAttribution();
  if ('error' in attr) {
    return NextResponse.json({ error: attr.error }, { status: 401 });
  }

  let body: { subject?: string; body?: string; priority?: 'low' | 'normal' | 'high' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const subject = (body.subject || '').trim() || 'Support request';
  const text    = (body.body || '').trim();
  const priority = (body.priority === 'low' || body.priority === 'high') ? body.priority : 'normal';

  if (!text) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });

  // Build the insert record. Only include opened_by_member_id when it is
  // actually set (avoids a PostgREST schema-cache error if migration 107
  // has not been applied yet — the API will surface a 500 with a helpful
  // message in that case rather than a cryptic schema error).
  const ticketInsert: Record<string, unknown> = {
    venue_id:             attr.venueId,
    opened_by_profile_id: attr.profileId,
    subject,
    status:               'open',
    priority,
    last_message_preview: text.slice(0, 240),
  };
  if (attr.memberId) ticketInsert.opened_by_member_id = attr.memberId;

  const { data: ticket, error: tErr } = await supabaseAdmin
    .from('support_threads')
    .insert(ticketInsert)
    .select('id, subject, status, priority, created_at, last_message_at')
    .single();

  if (tErr || !ticket) {
    return NextResponse.json({ error: tErr?.message || 'Failed to open ticket' }, { status: 500 });
  }

  // Insert the first message — same defensive pattern for sender_member_id.
  const msgInsert: Record<string, unknown> = {
    support_thread_id: (ticket as { id: string }).id,
    sender_type:       'venue',
    sender_profile_id: attr.profileId,
    body:              text,
  };
  if (attr.memberId) msgInsert.sender_member_id = attr.memberId;

  const { data: firstMsg, error: mErr } = await supabaseAdmin
    .from('support_thread_messages')
    .insert(msgInsert)
    .select('id, created_at')
    .single();

  if (mErr) {
    return NextResponse.json(
      { error: `Ticket created but failed to insert first message: ${mErr.message}`, ticket },
      { status: 500 },
    );
  }

  if (firstMsg) {
    void broadcastTicketMessage({
      ticketId:   (ticket as { id: string }).id,
      venueId:    attr.venueId,
      messageId:  (firstMsg as { id: string }).id,
      senderType: 'venue',
      body:       text,
      createdAt:  (firstMsg as { created_at?: string }).created_at || new Date().toISOString(),
      status:     'open',
    });
  }

  return NextResponse.json({ ok: true, ticket }, { status: 201 });
}
