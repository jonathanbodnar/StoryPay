/**
 * DELETE /api/admin/ai-concierge/leads/[leadId]/tags/[tagId]
 *
 * Removes a tag from a lead.
 *
 * If the removed tag is one of the reserved AI control system tags:
 *   ai_active  → transition lead to 'paused' (stop sends, preserve progress)
 *   ai_paused  → transition lead to 'dormant' (clear state entirely)
 *   ai_handoff → transition lead to 'paused'  (un-flag handoff, stop sends)
 *
 * Previously this was a bare delete with no state side-effects, meaning an
 * operator could remove the "AI Active" tag from a lead in the monitor and
 * the lead would silently keep receiving AI messages because ai_state never
 * changed. All AI control tags now mirror the POST handler in routing through
 * setLeadAiState so ai_state, audit trail, and tag sync stay in sync.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { setLeadAiState } from '@/lib/ai-concierge/state-control';
import type { AiState } from '@/lib/ai-concierge/types';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

// What state to drive the lead to when an AI control tag is REMOVED.
// Deliberately conservative: removing ai_active pauses (not dormant) so
// progress is not lost; pausing by tag = fully dormant.
const REMOVE_TAG_KEY_TO_AI_STATE: Record<string, AiState> = {
  ai_active:  'paused',
  ai_paused:  'dormant',
  ai_handoff: 'paused',
};

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string; tagId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId, tagId } = await params;

  // Look up the tag to check if it's an AI control system tag
  const { data: tag } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, system_key, venue_id')
    .eq('id', tagId)
    .maybeSingle();

  const driveTo = tag?.system_key ? REMOVE_TAG_KEY_TO_AI_STATE[tag.system_key] ?? null : null;

  if (driveTo && tag) {
    // For AI control tags, route through setLeadAiState — it handles the
    // state update, audit row, and syncAiStateTag (which will delete this
    // tag and apply the correct replacement).
    const result = await setLeadAiState({
      leadId,
      venueId:     tag.venue_id,
      newState:    driveTo,
      reason:      `tag_removed:${tag.system_key}`,
      triggeredBy: 'admin_monitor:tag_remove',
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Failed to apply state change' }, { status: 500 });
    }
    return NextResponse.json({
      ok:            true,
      drivenAiState: result.toState,
      fromState:     result.fromState,
    });
  }

  // Regular (non-AI-state) tag — plain delete
  const { error } = await supabaseAdmin
    .from('lead_tag_assignments')
    .delete()
    .eq('lead_id', leadId)
    .eq('tag_id', tagId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
