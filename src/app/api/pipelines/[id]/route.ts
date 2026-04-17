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

/**
 * PATCH /api/pipelines/[id]
 *   body: { name?, is_default?, position? }
 *
 * Rename a pipeline, toggle its default flag, or reorder it.
 *
 * Setting `is_default: true` also clears the default flag on the venue's
 * other pipelines so the partial-unique index is happy.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  let body: { name?: string; is_default?: boolean; position?: number };
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
  if (typeof body.position === 'number') updates.position = body.position;

  // Only one default per venue.
  if (body.is_default === true) {
    await supabaseAdmin
      .from('lead_pipelines')
      .update({ is_default: false })
      .eq('venue_id', venueId)
      .neq('id', id);
    updates.is_default = true;
  } else if (body.is_default === false) {
    updates.is_default = false;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('lead_pipelines')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}

/**
 * DELETE /api/pipelines/[id]
 *
 * Delete a pipeline. The default pipeline can't be deleted — the user has
 * to mark a different pipeline as default first. Leads attached to this
 * pipeline have their pipeline_id/stage_id set to null (ON DELETE SET NULL).
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  const { data: target } = await supabaseAdmin
    .from('lead_pipelines')
    .select('id, is_default')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!target) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 });
  if (target.is_default) {
    return NextResponse.json(
      { error: 'Cannot delete the default pipeline. Make another pipeline the default first.' },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from('lead_pipelines')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}
