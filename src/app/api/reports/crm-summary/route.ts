import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Pipeline value, lost reasons, booked value this month vs goal */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const isoStart = startOfMonth.toISOString();

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('monthly_booking_goal')
    .eq('id', venueId)
    .maybeSingle();
  const goal = (venue?.monthly_booking_goal as number | null) ?? null;

  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('id, opportunity_value, lost_reason, status, stage_id, updated_at')
    .eq('venue_id', venueId);

  const rows = (leads ?? []) as Array<{
    id: string;
    opportunity_value: number | null;
    lost_reason: string | null;
    status: string;
    stage_id: string | null;
    updated_at: string | null;
  }>;

  let pipelineValue = 0;
  const lostByReason: Record<string, number> = {};
  let bookedThisMonth = 0;

  for (const l of rows) {
    pipelineValue += Number(l.opportunity_value ?? 0);
    if (l.lost_reason?.trim()) {
      const k = l.lost_reason.trim();
      lostByReason[k] = (lostByReason[k] ?? 0) + 1;
    }
    if (l.status === 'booked_wedding' && l.updated_at && l.updated_at >= isoStart) {
      bookedThisMonth += Number(l.opportunity_value ?? 0);
    }
  }

  const lostReasons = Object.entries(lostByReason)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    pipelineValue,
    bookedThisMonth,
    monthlyBookingGoal: goal,
    lostReasons,
    leadCount: rows.length,
  });
}
