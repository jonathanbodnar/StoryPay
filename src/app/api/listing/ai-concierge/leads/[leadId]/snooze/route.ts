/**
 * PATCH /api/listing/ai-concierge/leads/[leadId]/snooze
 *
 * Push the next AI send forward for a lead belonging to the signed-in venue.
 *
 * Body: { minutes: number }  (any positive integer, e.g. 1, 30, 60, 240, 1440)
 *   OR: { days: 1 | 2 | 3 } (backward-compat)
 *
 * For very short snoozes (< 4 hours) quiet-hour enforcement is skipped so the
 * lead can resume quickly even if it falls inside a quiet window.
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enforceQuietHours } from '@/lib/ai-concierge/quiet-hours';
import { resolveVenueTimezone } from '@/lib/venue-timezone';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leadId } = await params;
  const body = await req.json().catch(() => ({})) as { days?: number; minutes?: number };

  // Resolve to total minutes
  let totalMinutes: number;
  if (body.minutes !== undefined) {
    totalMinutes = Number(body.minutes);
    if (!Number.isFinite(totalMinutes) || totalMinutes < 1 || totalMinutes > 60 * 24 * 30) {
      return NextResponse.json({ error: 'minutes must be between 1 and 43200' }, { status: 400 });
    }
  } else if (body.days !== undefined) {
    const days = Number(body.days);
    if (![1, 2, 3].includes(days)) {
      return NextResponse.json({ error: 'days must be 1, 2, or 3' }, { status: 400 });
    }
    totalMinutes = days * 24 * 60;
  } else {
    return NextResponse.json({ error: 'Provide minutes or days' }, { status: 400 });
  }

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, ai_state, venues(timezone)')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  if (lead.ai_state !== 'ai_active' && lead.ai_state !== 'paused') {
    return NextResponse.json({ error: 'Lead is not in an active state' }, { status: 409 });
  }

  const rawTz  = (lead.venues as { timezone?: string | null } | null)?.timezone ?? null;
  const tz     = resolveVenueTimezone(rawTz);
  const target = new Date(Date.now() + totalMinutes * 60 * 1000);

  // Skip quiet-hour adjustment for short snoozes (<= 4 h) so the lead resumes promptly
  const nextSendAt = totalMinutes <= 240 ? target : enforceQuietHours(target, tz);

  const { error } = await supabaseAdmin
    .from('leads')
    .update({ ai_next_send_at: nextSendAt.toISOString(), updated_at: new Date().toISOString() })
    .eq('id', leadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const label = totalMinutes < 60
    ? `${totalMinutes} min`
    : totalMinutes < 1440
      ? `${Math.round(totalMinutes / 60)} hr`
      : `${Math.round(totalMinutes / 1440)}d`;

  return NextResponse.json({
    ok: true,
    nextSendAt: nextSendAt.toISOString(),
    message: `AI paused for ${label}. Next send at ${nextSendAt.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
  });
}
