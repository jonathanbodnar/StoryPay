import { NextRequest, NextResponse } from 'next/server';
import { getVenueId } from '@/lib/auth-helpers';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/marketing/automations/[id]/enrollments/advance
// Body: { enrollmentIds: string[] }
// Immediately advances the selected enrollments to the next step by
// setting next_run_at = NOW(). The cron will then process them on the
// next tick — which is exactly how real progression works, just triggered
// manually rather than by the scheduler.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  // Verify ownership
  const { data: auto } = await supabaseAdmin
    .from('marketing_automations')
    .select('id')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!auto) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { enrollmentIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ids = (body.enrollmentIds ?? []).filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: 'No enrollment IDs provided' }, { status: 400 });

  // Safety check: ensure all supplied enrollments belong to this automation + venue
  const { data: owned } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .select('id')
    .eq('automation_id', id)
    .eq('venue_id', venueId)
    .in('id', ids);
  const safeIds = (owned ?? []).map((r) => r.id as string);
  if (!safeIds.length) return NextResponse.json({ error: 'No valid enrollment IDs' }, { status: 400 });

  // Set next_run_at to now — the cron will immediately process on its next tick
  const { error } = await supabaseAdmin
    .from('marketing_automation_enrollments')
    .update({ next_run_at: new Date().toISOString() })
    .in('id', safeIds)
    .eq('status', 'active');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ advanced: safeIds.length });
}
