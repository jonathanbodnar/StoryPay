/**
 * PATCH /api/listing/ai-concierge/leads/[leadId]/state
 *
 * Venue-side AI state control. Allows pause, resume, or handoff
 * for a lead belonging to the signed-in venue.
 *
 * body: { action: 'pause' | 'resume' | 'handoff' }
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { setLeadAiState } from '@/lib/ai-concierge/state-control';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const { action } = await req.json() as { action?: string };

  if (action !== 'pause' && action !== 'resume' && action !== 'handoff') {
    return NextResponse.json({ error: 'action must be "pause", "resume", or "handoff"' }, { status: 400 });
  }

  // Confirm the lead belongs to this venue
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, ai_state')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const newState = action === 'pause' ? 'paused' : action === 'resume' ? 'ai_active' : 'handoff';

  if (action === 'pause' && lead.ai_state !== 'ai_active') {
    return NextResponse.json({ error: 'Lead is not currently active.' }, { status: 409 });
  }
  // 'resume' is permissive — works from paused, handoff, dormant, or null.
  // It just means: turn AI back on for this contact.
  if (action === 'resume' && lead.ai_state === 'opted_out') {
    return NextResponse.json({ error: 'Lead is opted out (TCPA). Use the override on the contact profile.' }, { status: 409 });
  }

  const result = await setLeadAiState({
    leadId,
    venueId,
    newState: newState as 'paused' | 'ai_active' | 'handoff',
    reason: `venue_monitor:${action}`,
    triggeredBy: 'venue_monitor',
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Failed to update state' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fromState: result.fromState, toState: result.toState });
}
