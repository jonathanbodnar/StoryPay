/**
 * POST /api/admin/support/tickets/[id]/reply
 *
 * Appends a support-agent reply to a support ticket. Auto-bumps status from
 * 'open' → 'pending' (waiting on venue) unless the caller passes status='open'.
 *
 * Body:
 *   { body: string, supportUserId?: string, status?: 'open'|'pending'|'closed' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { broadcastTicketMessage } from '@/lib/realtime/broadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  let body: { body?: string; supportUserId?: string; status?: 'open' | 'pending' | 'closed' };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = (body.body || '').trim();
  if (!text) return NextResponse.json({ error: 'Empty message body' }, { status: 400 });

  const supportUserId = agent?.sub || (body.supportUserId || '').trim();
  if (!supportUserId) {
    return NextResponse.json(
      { error: 'Sign in as a support agent or pass supportUserId.' },
      { status: 400 },
    );
  }

  // Validate the support user exists
  const { data: stm } = await supabaseAdmin
    .from('support_team_members')
    .select('id, active')
    .eq('id', supportUserId)
    .maybeSingle();
  if (!stm || !(stm as { active: boolean }).active) {
    return NextResponse.json({ error: 'Support user not found or inactive' }, { status: 400 });
  }

  // Ensure the ticket exists
  const { data: ticketRow } = await supabaseAdmin
    .from('support_threads')
    .select('id, status')
    .eq('id', ticketId)
    .maybeSingle();
  if (!ticketRow) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  // Insert message
  const { data: msg, error: msgErr } = await supabaseAdmin
    .from('support_thread_messages')
    .insert({
      support_thread_id:      ticketId,
      sender_type:            'support',
      sender_support_user_id: supportUserId,
      body:                   text,
    })
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

  return NextResponse.json({
    ok: true,
    messageId: (msg as { id: string }).id,
    status:    finalStatus,
  });
}
