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
 * POST /api/pipelines/[id]/stages
 *   body: { name: string, color?: string, kind?: 'open' | 'won' | 'lost' }
 *
 * Append a new stage to a pipeline. It's placed at the end.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: pipelineId } = await context.params;

  let body: { name?: string; color?: string; kind?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Stage name is required' }, { status: 400 });

  const kind = body.kind && VALID_KINDS.has(body.kind) ? body.kind : 'open';
  const color = (body.color || '').trim() || '#6b7280';

  // Confirm pipeline belongs to this venue before mutating.
  const { data: pipeline } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });

  const { data: last } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .select('position')
    .eq('pipeline_id', pipelineId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = last && last[0] ? (last[0].position ?? 0) + 1 : 0;

  const { error } = await supabaseAdmin
    .from('lead_pipeline_stages')
    .insert({
      pipeline_id: pipelineId,
      venue_id:    venueId,
      name,
      color,
      kind,
      position:    nextPos,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}

/**
 * PATCH /api/pipelines/[id]/stages
 *   body: { order: string[] }   // stageIds in the desired order
 *
 * Bulk-reorder the stages inside a pipeline. The UI calls this after a drag
 * of a column header. We update each row's `position` in one shot.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: pipelineId } = await context.params;

  let body: { order?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.order)) {
    return NextResponse.json({ error: '`order` array required' }, { status: 400 });
  }

  // Confirm the pipeline belongs to this venue.
  const { data: pipeline } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id')
    .eq('id', pipelineId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!pipeline) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });

  for (let i = 0; i < body.order.length; i++) {
    const stageId = body.order[i];
    await supabaseAdmin
      .from('lead_pipeline_stages')
      .update({ position: i })
      .eq('id', stageId)
      .eq('pipeline_id', pipelineId)
      .eq('venue_id', venueId);
  }

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}
