import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getVenueId() {
  const { cookies } = await import('next/headers');
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

async function assertLead(venueId: string, leadId: string) {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();
  return !error && !!data;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: leadId } = await context.params;
  if (!(await assertLead(venueId, leadId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabaseAdmin
    .from('lead_tasks')
    .select('id, title, due_at, completed_at, created_at')
    .eq('lead_id', leadId)
    .eq('venue_id', venueId)
    .order('due_at', { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: leadId } = await context.params;
  if (!(await assertLead(venueId, leadId))) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { title?: string; dueAt?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  const dueAt = body.dueAt ? new Date(body.dueAt).toISOString() : null;

  const { data, error } = await supabaseAdmin
    .from('lead_tasks')
    .insert({ venue_id: venueId, lead_id: leadId, title, due_at: dueAt })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}
