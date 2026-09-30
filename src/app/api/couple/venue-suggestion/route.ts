import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/couple/venue-suggestion   { venueName, location? }
 *
 * A couple couldn't find their venue on StoryVenue. Their suggestion goes to
 * the team's Slack as a warm lead to invite. Nothing is emailed to the venue
 * automatically and nothing is stored; the team decides whether to reach out.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const gate = rateLimit(`venue-suggestion:${user.id}`, 5, 24 * 60 * 60 * 1000);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'Thanks, we already have your suggestions for today.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { venueName?: unknown; location?: unknown };
  const venueName = typeof body.venueName === 'string' ? body.venueName.trim().slice(0, 150) : '';
  const location = typeof body.location === 'string' ? body.location.trim().slice(0, 150) || null : null;
  if (venueName.length < 2) return NextResponse.json({ error: 'Enter your venue’s name.' }, { status: 400 });

  const { data: profile } = await supabaseAdmin
    .from('couple_profiles')
    .select('first_name, partner_first_name, wedding_date')
    .eq('id', user.id)
    .maybeSingle();
  const p = (profile ?? {}) as { first_name?: string | null; partner_first_name?: string | null; wedding_date?: string | null };
  const coupleName = [p.first_name, p.partner_first_name].filter(Boolean).join(' & ') || null;

  try {
    const { notifyVenueSuggestion } = await import('@/lib/slack-notify');
    await notifyVenueSuggestion({
      venueName,
      location,
      coupleName,
      coupleEmail: user.email ?? null,
      weddingDate: p.wedding_date ?? null,
    });
  } catch (e) {
    console.warn('[couple/venue-suggestion] slack notify failed', e);
  }
  return NextResponse.json({ ok: true });
}
