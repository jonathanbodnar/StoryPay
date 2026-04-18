import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { fetchLeadActivity, insertLeadActivity } from '@/lib/lead-activity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/** GET — activity log for a lead */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: leadId } = await context.params;

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const rows = await fetchLeadActivity(venueId, leadId);
  const memberIds = [...new Set(rows.map((r) => (r as { actor_member_id?: string }).actor_member_id).filter(Boolean))] as string[];
  let names: Record<string, string> = {};
  if (memberIds.length > 0) {
    const { data: members } = await supabaseAdmin
      .from('venue_team_members')
      .select('id, first_name, last_name, name')
      .eq('venue_id', venueId)
      .in('id', memberIds);
    for (const m of members ?? []) {
      const mm = m as { id: string; first_name: string | null; last_name: string | null; name: string | null };
      names[mm.id] = [mm.first_name, mm.last_name].filter(Boolean).join(' ') || mm.name || 'Team member';
    }
  }

  const enriched = rows.map((r) => {
    const row = r as {
      id: string;
      actor_member_id: string | null;
      actor_is_owner: boolean;
      action: string;
      details: Record<string, unknown>;
      created_at: string;
    };
    return {
      ...row,
      actor_label: row.actor_is_owner
        ? 'Owner'
        : row.actor_member_id
          ? names[row.actor_member_id] ?? 'Team member'
          : 'System',
    };
  });

  return NextResponse.json({ activity: enriched });
}

/** POST — log a call / quick touch */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: leadId } = await context.params;
  let body: { kind?: string; summary?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!summary) return NextResponse.json({ error: 'summary required' }, { status: 400 });

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await insertLeadActivity({
    venueId,
    leadId,
    actorMemberId: user.memberId,
    actorIsOwner: !user.memberId,
    action: 'call_logged',
    details: { summary, kind: body.kind || 'call' },
  });

  return NextResponse.json({ ok: true });
}
