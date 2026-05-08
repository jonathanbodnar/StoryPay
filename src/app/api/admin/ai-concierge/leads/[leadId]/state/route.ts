/**
 * PATCH /api/admin/ai-concierge/leads/[leadId]/state
 *
 * Super-admin: change a lead's AI state directly.
 * Valid transitions from the monitor:
 *   dormant   → ai_active  (first-time manual activation; 60-day window opens)
 *   ai_active → paused     (pause without losing progress)
 *   paused    → ai_active  (resume — resets ai_next_send_at to now+1h)
 *   any       → handoff    (mark for human follow-up)
 *
 * All side effects (state column, audit row, system tag) flow through
 * setLeadAiState in lib/ai-concierge/state-control.ts.
 *
 * Body: { state: 'paused' | 'ai_active' | 'handoff', reason?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { setLeadAiState } from '@/lib/ai-concierge/state-control';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

const ALLOWED_STATES = ['paused', 'ai_active', 'handoff'] as const;
type AllowedState = typeof ALLOWED_STATES[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const body = await req.json().catch(() => ({})) as { state?: string; reason?: string };

  if (!body.state || !ALLOWED_STATES.includes(body.state as AllowedState)) {
    return NextResponse.json(
      { error: `state must be one of: ${ALLOWED_STATES.join(', ')}` },
      { status: 400 },
    );
  }

  const newState = body.state as AllowedState;
  const reason   = body.reason ?? `admin_override:${newState}`;

  // Resolve the venue_id without re-reading state (setLeadAiState reads it itself)
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('venue_id')
    .eq('id', leadId)
    .single();
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const result = await setLeadAiState({
    leadId,
    venueId:     lead.venue_id,
    newState,
    reason,
    triggeredBy: 'admin_monitor',
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'Failed to update state' }, { status: 500 });
  }

  return NextResponse.json({
    ok:        true,
    fromState: result.fromState,
    toState:   result.toState,
    noop:      result.noop,
  });
}
