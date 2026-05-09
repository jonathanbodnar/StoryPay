/**
 * GET /api/listing/ai-concierge/contact-lead?email={email}
 *
 * Returns the AI-concierge lead record for the given email address within
 * the signed-in venue. Used by the conversations page to show per-contact
 * AI status and provide Start / Pause / Stop controls.
 */
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime  = 'nodejs';

export async function GET(req: NextRequest) {
  const c = await cookies();
  const venueId = c.get('venue_id')?.value;
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });

  const { data: lead } = await supabaseAdmin
    .from('leads')
    .select('id, ai_state, ai_next_send_at, ai_expires_at, ai_attempt_count, ai_first_activated_at')
    .eq('venue_id', venueId)
    .ilike('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) return NextResponse.json({ lead: null });

  return NextResponse.json({
    lead: {
      id:                    lead.id,
      ai_state:              lead.ai_state,
      ai_next_send_at:       lead.ai_next_send_at,
      ai_expires_at:         lead.ai_expires_at,
      ai_attempt_count:      lead.ai_attempt_count ?? 0,
      ai_first_activated_at: lead.ai_first_activated_at,
    },
  });
}
