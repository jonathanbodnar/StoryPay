/**
 * PATCH /api/admin/ai-concierge/leads/[leadId]/state
 *
 * Super-admin: change a lead's AI state directly.
 * Valid transitions from the monitor:
 *   ai_active → paused   (pause without losing progress)
 *   paused    → ai_active (resume — resets ai_next_send_at to now+1h so cron picks it up)
 *   any       → handoff  (mark for human follow-up)
 *
 * Records an ai_state_transitions row for audit trail.
 *
 * Body: { state: 'paused' | 'ai_active' | 'handoff' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { recordAiStateTransition } from '@/lib/ai-concierge/state-transitions';
import type { AiState } from '@/lib/ai-concierge/types';

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

  // Fetch current state for transition record
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, venue_id, ai_state')
    .eq('id', leadId)
    .single();

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const fromState = lead.ai_state as string;

  // Update the lead state
  const update: Record<string, unknown> = {
    ai_state:   newState,
    updated_at: new Date().toISOString(),
  };

  // When resuming, set next send to 1 hour from now so the cron picks it up
  // without immediately flooding. Operator can force-send if they want now.
  if (newState === 'ai_active' && fromState === 'paused') {
    update.ai_next_send_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  }

  const { error } = await supabaseAdmin
    .from('leads')
    .update(update)
    .eq('id', leadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit trail
  await recordAiStateTransition({
    leadId,
    venueId:     lead.venue_id,
    fromState:   fromState as AiState,
    toState:     newState  as AiState,
    reason,
    triggeredBy: 'admin_monitor',
  }).catch(e => console.warn('[ai-state] transition log failed:', e));

  return NextResponse.json({ ok: true, fromState, toState: newState });
}
