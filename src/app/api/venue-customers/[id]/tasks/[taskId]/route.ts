import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id: customerId, taskId } = await params;

  const body = await request.json();
  const updates: Record<string, unknown> = {};
  if ('title' in body)        updates.title        = body.title?.trim() || null;
  if ('due_date' in body)     updates.due_date     = body.due_date || null;
  if ('completed_at' in body) updates.completed_at = body.completed_at || null;

  if (Object.keys(updates).length === 0) {
    const { data: current } = await supabaseAdmin
      .from('customer_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('customer_id', customerId)
      .eq('venue_id', venueId)
      .maybeSingle();
    return NextResponse.json(current ?? null);
  }

  const { data: row, error } = await supabaseAdmin
    .from('customer_tasks')
    .update(updates)
    .eq('id', taskId)
    .eq('customer_id', customerId)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[customer-tasks PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.completed_at && row) {
    await supabaseAdmin.from('customer_activity').insert({
      venue_id: venueId,
      customer_id: customerId,
      activity_type: 'task_completed',
      title: 'Task completed',
      description: row.title,
    });
  }

  return NextResponse.json(row);
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

  if (error) {
    console.error('[customer-tasks DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
