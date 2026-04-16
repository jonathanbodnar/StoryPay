import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId, taskId } = await params;

  const body = await request.json();
  const update: Record<string, unknown> = {};
  if ('title' in body)       update.title       = body.title?.trim();
  if ('due_date' in body)    update.due_date    = body.due_date || null;
  if ('completed_at' in body) update.completed_at = body.completed_at;

  const { data, error } = await supabaseAdmin
    .from('customer_tasks')
    .update(update)
    .eq('id', taskId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (update.completed_at) {
    await supabaseAdmin.from('customer_activity').insert({
      venue_id: venueId,
      customer_id: customerId,
      activity_type: 'task_completed',
      title: 'Task completed',
      description: data.title,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId, taskId } = await params;

  const { error } = await supabaseAdmin
    .from('customer_tasks')
    .delete()
    .eq('id', taskId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
