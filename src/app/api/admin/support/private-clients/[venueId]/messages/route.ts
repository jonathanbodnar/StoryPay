/**
 * GET /api/admin/support/private-clients/[venueId]/messages
 *
 * Recent ad hoc concierge → owner/team messages for one Private Client
 * venue, across all recipients (outbound-only log — see
 * private_client_messages). Used by the Support Inbox → Private Clients
 * detail pane so the team can see "who already reached out and when"
 * before sending another message.
 *
 * Auth: super admin OR support agent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const auth = await verifySupportAccess();
  if (!auth.isSuperAdmin && !auth.agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { venueId } = await params;
  if (!venueId) return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });

  const { data: rows, error } = await supabaseAdmin
    .from('private_client_messages')
    .select(
      'id, recipient_type, recipient_team_member_id, recipient_label, recipient_email, recipient_phone, channel, body, external_sent, send_error, sent_by_support_user_id, created_at',
    )
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const agentIds = Array.from(
    new Set(((rows ?? []) as Array<{ sent_by_support_user_id: string | null }>)
      .map((r) => r.sent_by_support_user_id)
      .filter((x): x is string => Boolean(x))),
  );
  const agentNameById = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabaseAdmin
      .from('support_team_members')
      .select('id, name')
      .in('id', agentIds);
    for (const a of (agents ?? []) as Array<{ id: string; name: string | null }>) {
      if (a.name) agentNameById.set(a.id, a.name);
    }
  }

  const messages = ((rows ?? []) as Array<{
    id: string; recipient_type: string; recipient_team_member_id: string | null;
    recipient_label: string; recipient_email: string | null; recipient_phone: string | null;
    channel: string; body: string; external_sent: boolean; send_error: string | null;
    sent_by_support_user_id: string | null; created_at: string;
  }>).map((r) => ({
    ...r,
    sentByName: r.sent_by_support_user_id ? agentNameById.get(r.sent_by_support_user_id) ?? 'Concierge team' : 'Concierge team',
  }));

  return NextResponse.json({ messages });
}
