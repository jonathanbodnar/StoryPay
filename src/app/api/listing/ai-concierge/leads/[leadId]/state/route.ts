/**
 * PATCH /api/listing/ai-concierge/leads/[leadId]/state
 *
 * Venue-side AI state control. Allows a venue owner/admin to pause or
 * resume AI for one of their own leads. They cannot force-send or manage
 * tags — those stay admin-only.
 *
 * body: { action: 'pause' | 'resume' }
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

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
  const { action } = await req.json() as { action?: string };

  if (action !== 'pause' && action !== 'resume') {
    return NextResponse.json({ error: 'action must be "pause" or "resume"' }, { status: 400 });
  }

  // Confirm the lead belongs to this venue
  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, ai_state')
    .eq('id', leadId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  if (action === 'pause') {
    if (lead.ai_state !== 'ai_active') {
      return NextResponse.json({ error: 'Lead is not currently active.' }, { status: 409 });
    }
    await supabaseAdmin.from('leads').update({ ai_state: 'paused' }).eq('id', leadId);
  } else {
    if (lead.ai_state !== 'paused') {
      return NextResponse.json({ error: 'Lead is not paused.' }, { status: 409 });
    }
    await supabaseAdmin.from('leads').update({ ai_state: 'ai_active' }).eq('id', leadId);
  }

  return NextResponse.json({ ok: true });
}
