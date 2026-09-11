import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { sendRsvpInvite } from '@/lib/rsvp-invite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/couple/guests/[id]/invite
 * Emails one guest their personal RSVP link (send or resend). Bride-only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: guest } = await supabaseAdmin
    .from('wedding_guests')
    .select('id, full_name, email, rsvp_token, invite_sent_count, venue_id')
    .eq('id', id)
    .eq('couple_id', user.id)
    .maybeSingle();

  const g = guest as
    | { id: string; full_name: string; email: string | null; rsvp_token: string; invite_sent_count: number | null; venue_id: string }
    | null;
  if (!g) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!g.email) return NextResponse.json({ error: 'Add an email for this guest first.' }, { status: 400 });

  const [{ data: profile }, { data: venueRow }] = await Promise.all([
    supabaseAdmin
      .from('couple_profiles')
      .select('display_name, first_name, last_name, wedding_date')
      .eq('id', user.id)
      .maybeSingle(),
    supabaseAdmin.from('venues').select('name').eq('id', g.venue_id).maybeSingle(),
  ]);

  const p = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null; wedding_date?: string | null }
    | null;
  const coupleName =
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || p?.display_name?.trim() || 'The couple';

  const result = await sendRsvpInvite({
    to: g.email,
    guestName: g.full_name,
    coupleName,
    token: g.rsvp_token,
    weddingDate: p?.wedding_date ?? null,
    venueName: (venueRow as { name?: string | null } | null)?.name ?? null,
    replyTo: user.email ?? null,
  });

  if (!result.success) {
    return NextResponse.json({ error: `Invite failed to send: ${result.error || 'unknown error'}` }, { status: 502 });
  }

  await supabaseAdmin
    .from('wedding_guests')
    .update({ invited_at: new Date().toISOString(), invite_sent_count: (g.invite_sent_count ?? 0) + 1 })
    .eq('id', g.id);

  return NextResponse.json({ ok: true });
}
