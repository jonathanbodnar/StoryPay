import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import { sendRsvpInvite } from '@/lib/rsvp-invite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface GuestLite {
  id: string;
  full_name: string;
  email: string | null;
  rsvp_token: string;
  invite_sent_count: number | null;
  responded_at: string | null;
}

/**
 * POST /api/couple/guests/invite-all
 * Body: { includeResponded?: boolean } (default false)
 * Emails RSVP links to every guest that has an email. By default skips guests
 * who already responded. Bride-only.
 */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let includeResponded = false;
  try {
    const body = (await request.json()) as { includeResponded?: boolean };
    includeResponded = body?.includeResponded === true;
  } catch {
    /* empty body is fine */
  }

  const [{ data: guests }, { data: profile }, { data: venueRow }] = await Promise.all([
    supabaseAdmin
      .from('wedding_guests')
      .select('id, full_name, email, rsvp_token, invite_sent_count, responded_at')
      .eq('couple_wedding_id', link.id),
    supabaseAdmin
      .from('couple_profiles')
      .select('display_name, first_name, last_name, wedding_date')
      .eq('id', user.id)
      .maybeSingle(),
    supabaseAdmin.from('venues').select('name').eq('id', link.venue_id).maybeSingle(),
  ]);

  const p = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null; wedding_date?: string | null }
    | null;
  const coupleName =
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || p?.display_name?.trim() || 'The couple';
  const venueName = (venueRow as { name?: string | null } | null)?.name ?? null;

  const rows = (guests ?? []) as GuestLite[];
  const targets = rows.filter((g) => g.email && (includeResponded || !g.responded_at));

  let sent = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const g of targets) {
    const result = await sendRsvpInvite({
      to: g.email as string,
      guestName: g.full_name,
      coupleName,
      token: g.rsvp_token,
      weddingDate: p?.wedding_date ?? null,
      venueName,
      replyTo: user.email ?? null,
    });
    if (result.success) {
      sent += 1;
      await supabaseAdmin
        .from('wedding_guests')
        .update({ invited_at: now, invite_sent_count: (g.invite_sent_count ?? 0) + 1 })
        .eq('id', g.id);
    } else {
      failed += 1;
    }
  }

  const skippedNoEmail = rows.filter((g) => !g.email).length;
  return NextResponse.json({ ok: true, sent, failed, skippedNoEmail });
}
