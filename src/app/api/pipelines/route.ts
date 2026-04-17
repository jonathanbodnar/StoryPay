import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  ensureDefaultPipeline,
  loadPipelinesWithStages,
  DEFAULT_STAGE_TEMPLATE,
} from '@/lib/pipelines';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

/**
 * GET /api/pipelines
 *
 * Returns every pipeline for the current venue, with its ordered stages.
 * If the venue has never touched the Leads page, we lazily provision the
 * default template so the Kanban always has something to render.
 */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await ensureDefaultPipeline(venueId);
    const pipelines = await loadPipelinesWithStages(venueId);
    return NextResponse.json({ pipelines });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load pipelines';
    console.error('[GET /api/pipelines] failed:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/pipelines
 *   body: { name: string, useDefaultStages?: boolean }
 *
 * Creates a new pipeline. If `useDefaultStages` is true (default), we also
 * create the standard template of 8 stages. The caller can also provide a
 * custom `stages` array to start with their own columns.
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    name?: string;
    useDefaultStages?: boolean;
    stages?: Array<{ name: string; color?: string; kind?: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'Pipeline name is required' }, { status: 400 });

  // Figure out the next `position` so the new pipeline appears at the end.
  const { data: existing } = await supabaseAdmin
    .from('lead_pipelines')
    .select('position')
    .eq('venue_id', venueId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = existing && existing[0] ? (existing[0].position ?? 0) + 1 : 0;

  const { data: pipeline, error } = await supabaseAdmin
    .from('lead_pipelines')
    .insert({
      venue_id:   venueId,
      name,
      is_default: false,
      position:   nextPos,
    })
    .select('*')
    .single();

  if (error || !pipeline) {
    return NextResponse.json({ error: error?.message || 'Failed to create pipeline' }, { status: 500 });
  }

  // Seed stages. Default template, unless the caller passed their own.
  const template =
    body.stages && body.stages.length > 0
      ? body.stages.map((s, i) => ({
          name:     s.name,
          color:    s.color || '#6b7280',
          kind:     (s.kind === 'won' || s.kind === 'lost' ? s.kind : 'open') as 'open' | 'won' | 'lost',
          position: i,
        }))
      : body.useDefaultStages === false
        ? []
        : DEFAULT_STAGE_TEMPLATE.map((s, i) => ({
            name:     s.name,
            color:    s.color,
            kind:     s.kind,
            position: i,
          }));

  if (template.length > 0) {
    const { error: sErr } = await supabaseAdmin.from('lead_pipeline_stages').insert(
      template.map((s) => ({
        pipeline_id: pipeline.id,
        venue_id:    venueId,
        name:        s.name,
        color:       s.color,
        kind:        s.kind,
        position:    s.position,
      })),
    );
    if (sErr) {
      console.error('[POST /api/pipelines] stage insert failed:', sErr);
    }
  }

  const pipelines = await loadPipelinesWithStages(venueId);
  return NextResponse.json({ pipelines });
}
