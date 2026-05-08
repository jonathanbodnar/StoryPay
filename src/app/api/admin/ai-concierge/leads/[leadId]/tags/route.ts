/**
 * GET  /api/admin/ai-concierge/leads/[leadId]/tags
 *   Returns the lead's current tags + all available tags for this venue.
 *
 * POST /api/admin/ai-concierge/leads/[leadId]/tags
 *   Adds a tag to the lead.
 *   Body: { tagId: string }
 *
 *   If the tag is one of the reserved AI state system tags (system_key in
 *   ai_active / ai_paused / ai_handoff), this *also* changes the lead's
 *   ai_state via setLeadAiState — letting an admin manually activate or
 *   pause the AI Concierge for a single lead just by adding the tag.
 *   The state-tag-sync side effect from setLeadAiState handles the actual
 *   tag write, so we don't double-insert.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminCookie } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { setLeadAiState } from '@/lib/ai-concierge/state-control';
import type { AiState } from '@/lib/ai-concierge/types';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

// Map a system_key on a marketing_tag → the ai_state we should drive it to
// when the operator adds that tag manually. Mirrors the const in
// lib/ai-concierge/state-control.ts; kept here only because we resolve the
// system_key inline in the venue-tag check below.
const TAG_KEY_TO_AI_STATE: Record<string, AiState> = {
  ai_active:  'ai_active',
  ai_paused:  'paused',
  ai_handoff: 'handoff',
};

async function getLeadVenueId(leadId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('leads')
    .select('venue_id')
    .eq('id', leadId)
    .single();
  return data?.venue_id ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const venueId = await getLeadVenueId(leadId);
  if (!venueId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  // Current tags on this lead
  const { data: assigned } = await supabaseAdmin
    .from('lead_tag_assignments')
    .select('tag_id, marketing_tags(id, name, icon, color, is_system, system_key, category)')
    .eq('lead_id', leadId);

  // All available tags for this venue
  const { data: allTags } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, name, icon, color, is_system, system_key, category, position')
    .eq('venue_id', venueId)
    .order('position', { ascending: true, nullsFirst: false });

  const assignedIds = new Set((assigned ?? []).map((a: { tag_id: string }) => a.tag_id));

  return NextResponse.json({
    assigned: (assigned ?? []).map((a: { tag_id: string; marketing_tags: unknown }) => a.marketing_tags),
    available: (allTags ?? []).filter((t: { id: string }) => !assignedIds.has(t.id)),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const ok = await verifyAdminCookie();
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const body = await req.json().catch(() => ({})) as { tagId?: string };
  if (!body.tagId) return NextResponse.json({ error: 'Missing tagId' }, { status: 400 });

  const venueId = await getLeadVenueId(leadId);
  if (!venueId) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  // Verify tag belongs to this venue + grab system_key so we know if this
  // tag should drive an AI state change.
  const { data: tag } = await supabaseAdmin
    .from('marketing_tags')
    .select('id, venue_id, is_system, system_key')
    .eq('id', body.tagId)
    .eq('venue_id', venueId)
    .single();
  if (!tag) return NextResponse.json({ error: 'Tag not found for this venue' }, { status: 404 });

  // ── Path A: AI control tag → route through setLeadAiState ────────────────
  // setLeadAiState fires syncAiStateTag as a side effect, so the tag is
  // written by that path and we do not double-insert here.
  const driveTo = (tag.system_key && TAG_KEY_TO_AI_STATE[tag.system_key]) || null;
  if (driveTo) {
    const result = await setLeadAiState({
      leadId,
      venueId,
      newState:    driveTo,
      reason:      `tag_added:${tag.system_key}`,
      triggeredBy: 'admin_monitor:tag',
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Failed to apply state' }, { status: 500 });
    }
    return NextResponse.json({
      ok:           true,
      drivenAiState: result.toState,
      fromState:    result.fromState,
      noop:         result.noop,
    });
  }

  // ── Path B: regular tag → simple assignment ──────────────────────────────
  const { error } = await supabaseAdmin
    .from('lead_tag_assignments')
    .upsert({ lead_id: leadId, tag_id: body.tagId, venue_id: venueId }, { onConflict: 'lead_id,tag_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
