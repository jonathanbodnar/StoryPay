import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from('customer_tasks')
    .select('*')
    .eq('customer_id', id)
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[customer-tasks GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const { title, due_date } = await request.json();
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  const trimmed = title.trim();

  const { data: row, error } = await supabaseAdmin
    .from('customer_tasks')
    .insert({
      customer_id: id,
      venue_id: venueId,
      title: trimmed,
      due_date: due_date || null,
    })
    .select('*')
    .single();

  if (error || !row) {
    console.error('[customer-tasks POST]', error);
    return NextResponse.json({ error: error?.message ?? 'Failed to save task' }, { status: 500 });
  }

  await supabaseAdmin.from('customer_activity').insert({
    venue_id: venueId,
    customer_id: id,
    activity_type: 'task_created',
    title: 'Task created',
    description: trimmed,
  });

  return NextResponse.json(row, { status: 201 });
}
