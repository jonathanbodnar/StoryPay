import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadPipelinesWithStages } from '@/lib/pipelines';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

const VALID_KINDS = new Set(['open', 'won', 'lost']);

/**
 * PATCH /api/pipelines/[id]/stages/[stageId]
 *   body: { name?, color?, kind?, winProbability? }
 *
 * Rename a stage / change its color / change its kind (open|won|lost).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; stageId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: pipelineId, stageId } = await context.params;

  let body: { name?: string; color?: string; kind?: string; winProbability?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    updates.name = trimmed;
  }
  if (typeof body.color === 'string' && body.color.trim()) updates.color = body.color.trim();
  if (typeof body.kind === 'string' && VALID_KINDS.has(body.kind)) updates.kind = body.kind;
  if (body.winProbability === null) updates.win_probability = null;
  else if (typeof body.winProbability === 'number' && !Number.isNaN(body.winProbability)) {
    updates.win_probability = Math.min(100, Math.max(0, body.winProbability));
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .update(updates)
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}

/**
 * DELETE /api/pipelines/[id]/stages/[stageId]
 *
 * Remove a stage. Any leads in this stage have their stage_id cleared
 * (handled by ON DELETE SET NULL). The pipeline must keep at least one
 * stage — deleting the last column is rejected to keep the UI usable.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; stageId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: pipelineId, stageId } = await context.params;

  const { count } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('pipeline_id', pipelineId)
    .eq('venue_id', venueId);

  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: 'A pipeline needs at least one stage. Add another stage before deleting this one.' },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .delete()
    .eq('id', stageId)
    .eq('pipeline_id', pipelineId)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}
