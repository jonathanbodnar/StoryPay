/**
 * PATCH /api/listing/ai-concierge/leads/[leadId]/snooze
 *
 * Push the next AI send forward by 1, 2, or 3 days for a lead
 * belonging to the signed-in venue.
 *
 * Body: { days: 1 | 2 | 3 }
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
  const body = await req.json().catch(() => ({})) as { days?: number };

  const days = Number(body.days);
  if (![1, 2, 3].includes(days)) {
    return NextResponse.json({ error: 'days must be 1, 2, or 3' }, { status: 400 });
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

  const rawTz     = (lead.venues as { timezone?: string | null } | null)?.timezone ?? null;
  const tz        = resolveVenueTimezone(rawTz);
  const target    = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const nextSendAt = enforceQuietHours(target, tz);

  const { error } = await supabaseAdmin
    .from('leads')
    .update({ ai_next_send_at: nextSendAt.toISOString(), updated_at: new Date().toISOString() })
    .eq('id', leadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    nextSendAt: nextSendAt.toISOString(),
    message: `Next send rescheduled to ${nextSendAt.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
  });
}
