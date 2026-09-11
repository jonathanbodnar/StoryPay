import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Public, no-login guest RSVP endpoint.
 *
 * A guest opens /rsvp/<rsvp_token> (emailed to them by the couple) and this
 * endpoint powers it. The token is an unguessable per-guest UUID; possession of
 * it is the authorization. We only ever expose that one guest's row plus public
 * wedding/venue display info — never the rest of the guest list.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GuestRow {
  id: string;
  full_name: string;
  party_size: number | null;
  rsvp_status: string | null;
  meal_choice: string | null;
  dietary_notes: string | null;
  responded_at: string | null;
  couple_wedding_id: string;
  couple_id: string | null;
  venue_id: string;
}

async function loadGuestByToken(token: string): Promise<GuestRow | null> {
  const { data } = await supabaseAdmin
    .from('wedding_guests')
    .select(
      'id, full_name, party_size, rsvp_status, meal_choice, dietary_notes, responded_at, couple_wedding_id, couple_id, venue_id',
    )
    .eq('rsvp_token', token)
    .maybeSingle();
  return (data as GuestRow | null) ?? null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** GET — hydrate the public RSVP page for one guest. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid RSVP link.' }, { status: 404 });
  }

  const guest = await loadGuestByToken(token);
  if (!guest) {
    return NextResponse.json({ error: 'This RSVP link is no longer valid.' }, { status: 404 });
  }

  const [{ data: weddingRow }, { data: venueRow }, { data: profile }] = await Promise.all([
    supabaseAdmin.from('couple_weddings').select('meal_options').eq('id', guest.couple_wedding_id).maybeSingle(),
    supabaseAdmin
      .from('venues')
      .select('name, location_city, location_state, cover_image_url')
      .eq('id', guest.venue_id)
      .maybeSingle(),
    guest.couple_id
      ? supabaseAdmin
          .from('couple_profiles')
          .select('display_name, first_name, last_name, wedding_date')
          .eq('id', guest.couple_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const mealOptionsRaw = (weddingRow as { meal_options?: unknown } | null)?.meal_options ?? [];
  const mealOptions = Array.isArray(mealOptionsRaw) ? (mealOptionsRaw as string[]) : [];

  const p = profile as
    | { display_name?: string | null; first_name?: string | null; last_name?: string | null; wedding_date?: string | null }
    | null;
  const coupleName =
    [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim() || p?.display_name?.trim() || 'The couple';

  const v = venueRow as
    | { name?: string | null; location_city?: string | null; location_state?: string | null; cover_image_url?: string | null }
    | null;

  return NextResponse.json({
    guest: {
      name: guest.full_name,
      partySize: Math.max(1, Number(guest.party_size) || 1),
      rsvpStatus: guest.rsvp_status ?? 'pending',
      mealChoice: guest.meal_choice,
      dietaryNotes: guest.dietary_notes,
      responded: Boolean(guest.responded_at),
    },
    wedding: {
      coupleName,
      weddingDate: p?.wedding_date ?? null,
    },
    venue: {
      name: v?.name ?? null,
      city: v?.location_city ?? null,
      state: v?.location_state ?? null,
      coverImageUrl: v?.cover_image_url ?? null,
    },
    mealOptions,
  });
}

/** POST — the guest submits their RSVP. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || !UUID_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid RSVP link.' }, { status: 404 });
  }

  const guest = await loadGuestByToken(token);
  if (!guest) {
    return NextResponse.json({ error: 'This RSVP link is no longer valid.' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const attending = body.attending === true;

  const update: Record<string, unknown> = {
    rsvp_status: attending ? 'attending' : 'declined',
    responded_at: new Date().toISOString(),
  };

  if (attending) {
    // Confirmed headcount — clamp to a sane range. Falls back to the invited
    // party size when the guest doesn't touch the stepper.
    const invited = Math.max(1, Number(guest.party_size) || 1);
    const raw = Number(body.headcount);
    const headcount = Number.isFinite(raw) ? Math.round(raw) : invited;
    update.party_size = Math.min(30, Math.max(1, headcount || invited));

    // Only accept a meal that's actually on the couple's list.
    const meal = str(body.meal_choice, 120);
    if (meal) {
      const { data: weddingRow } = await supabaseAdmin
        .from('couple_weddings')
        .select('meal_options')
        .eq('id', guest.couple_wedding_id)
        .maybeSingle();
      const optsRaw = (weddingRow as { meal_options?: unknown } | null)?.meal_options ?? [];
      const opts = Array.isArray(optsRaw) ? (optsRaw as string[]) : [];
      update.meal_choice = opts.includes(meal) ? meal : null;
    } else {
      update.meal_choice = null;
    }

    update.dietary_notes = str(body.dietary_notes, 500);
  }

  const { error } = await supabaseAdmin
    .from('wedding_guests')
    .update(update)
    .eq('id', guest.id);

  if (error) {
    console.error('[rsvp POST]', error);
    return NextResponse.json({ error: 'Could not save your RSVP. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, attending });
}
