import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId() {
  const { cookies } = await import('next/headers');
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; taskId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: leadId, taskId } = await context.params;

  let body: { title?: string; dueAt?: string | null; completed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') patch.title = body.title.trim();
  if (body.dueAt !== undefined) patch.due_at = body.dueAt ? new Date(body.dueAt).toISOString() : null;
  if (body.completed === true) patch.completed_at = new Date().toISOString();
  if (body.completed === false) patch.completed_at = null;

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No updates' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('lead_tasks')
    .update(patch)
    .eq('id', taskId)
    .eq('lead_id', leadId)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ task: data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; taskId: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: leadId, taskId } = await context.params;

  const { data, error } = await supabaseAdmin
    .from('lead_tasks')
    .delete()
    .eq('id', taskId)
    .eq('lead_id', leadId)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
