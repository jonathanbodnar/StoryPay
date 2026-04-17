import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Status values enforced by the DB CHECK constraint on `public.leads.status`.
 */
const ALLOWED_STATUSES = new Set([
  'new',
  'contacted',
  'tour_booked',
  'proposal_sent',
  'booked_wedding',
  'not_interested',
]);

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  let body: { status?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!ALLOWED_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}` },
        { status: 400 },
      );
    }
    updates.status = body.status;
  }
  if (typeof body.notes === 'string') updates.notes = body.notes;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .update(updates)
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[PATCH /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({ lead: data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  const { data, error } = await supabaseAdmin
    .from('leads')
    .delete()
    .eq('id', id)
    .eq('venue_id', venueId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[DELETE /api/leads/[id]] failed:', error);
    return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
