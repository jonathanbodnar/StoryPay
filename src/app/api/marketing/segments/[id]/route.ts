import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';
import { parseSavedSegmentDefinition } from '@/lib/marketing-email-schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  const { data, error } = await supabaseAdmin
    .from('marketing_segments')
    .select('id, name, description, definition_json, created_at, updated_at')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Surface a usage count so the UI can warn before delete.
  const { count: usedBy } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', venueId)
    .filter('segment_json->>type', 'eq', 'saved_segment')
    .filter('segment_json->>saved_segment_id', 'eq', id);

  return NextResponse.json({ segment: data, usedByCampaigns: usedBy ?? 0 });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  let body: { name?: string; description?: string; definition?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    if (n.length > 200) return NextResponse.json({ error: 'Name is too long (max 200)' }, { status: 400 });
    updates.name = n;
  }
  if (typeof body.description === 'string') {
    updates.description = body.description.trim().slice(0, 500);
  }
  if (body.definition !== undefined) {
    updates.definition_json = parseSavedSegmentDefinition(body.definition);
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'No updates' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('marketing_segments')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id, name, description, definition_json, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A segment with that name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ segment: data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  // Detach: any campaign currently referencing this saved segment falls
  // back to "all leads" so the campaign stays valid and sendable. The
  // campaign owner can re-pick a segment afterwards.
  const { data: linked } = await supabaseAdmin
    .from('marketing_campaigns')
    .select('id, segment_json')
    .eq('venue_id', venueId)
    .filter('segment_json->>type', 'eq', 'saved_segment')
    .filter('segment_json->>saved_segment_id', 'eq', id);
  for (const row of linked ?? []) {
    const r = row as { id: string; segment_json: Record<string, unknown> | null };
    const next = { ...(r.segment_json ?? {}), type: 'all_leads' } as Record<string, unknown>;
    delete next.saved_segment_id;
    delete next.tag_ids;
    delete next.stage_ids;
    await supabaseAdmin
      .from('marketing_campaigns')
      .update({ segment_json: next, updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('venue_id', venueId);
  }

  const { data, error } = await supabaseAdmin
    .from('marketing_segments')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, detached: linked?.length ?? 0 });
}
