/**
 * POST /api/admin/support/tickets/[id]/status
 *
 * Updates a support ticket's status, priority, or assignee. Any subset of
 * the three fields may be supplied.
 *
 * Body:
 *   {
 *     status?:   'open' | 'pending' | 'closed',
 *     priority?: 'low'  | 'normal'  | 'high',
 *     assigned_support_user_id?: string | null,
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifySupportAccess } from '@/lib/support/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { broadcastTicketStatus } from '@/lib/realtime/broadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_VALUES = ['open', 'pending', 'closed'] as const;
const PRIORITY_VALUES = ['low', 'normal', 'high'] as const;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { isSuperAdmin, agent } = await verifySupportAccess();
  if (!isSuperAdmin && !agent) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'Missing ticket id' }, { status: 400 });

  let body: {
    status?:   string;
    priority?: string;
    assigned_support_user_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!(STATUS_VALUES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (typeof body.priority === 'string') {
    if (!(PRIORITY_VALUES as readonly string[]).includes(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    updates.priority = body.priority;
  }
  if ('assigned_support_user_id' in body) {
    if (body.assigned_support_user_id === null) {
      updates.assigned_support_user_id = null;
    } else if (typeof body.assigned_support_user_id === 'string' && body.assigned_support_user_id.trim()) {
      const targetId = body.assigned_support_user_id.trim();
      const { data: stm } = await supabaseAdmin
        .from('support_team_members')
        .select('id, active')
        .eq('id', targetId)
        .maybeSingle();
      if (!stm || !(stm as { active: boolean }).active) {
        return NextResponse.json({ error: 'Support user not found or inactive' }, { status: 400 });
      }
      updates.assigned_support_user_id = targetId;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('support_threads')
    .update(updates)
    .eq('id', id)
    .select('id, venue_id, status, priority, assigned_support_user_id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

  const row = data as {
    id: string;
    venue_id: string;
    status:   'open' | 'pending' | 'closed';
    priority: 'low' | 'normal' | 'high';
    assigned_support_user_id: string | null;
  };

  void broadcastTicketStatus({
    ticketId:              row.id,
    venueId:               row.venue_id,
    status:                row.status,
    priority:              row.priority,
    assignedSupportUserId: row.assigned_support_user_id,
  });

  return NextResponse.json({ ok: true, ticket: row });
}
