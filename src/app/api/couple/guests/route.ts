import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding, summarizeWeddingGuests } from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RSVP_STATUSES = ['pending', 'attending', 'declined'] as const;
type RsvpStatus = (typeof RSVP_STATUSES)[number];

/** Columns returned to the bride (she owns the full record incl. contact info). */
const GUEST_COLUMNS =
  'id, full_name, email, phone, address, party_size, rsvp_status, meal_choice, dietary_notes, guest_group, notes, created_at, updated_at';

export interface GuestInput {
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  party_size: number;
  rsvp_status: RsvpStatus;
  meal_choice: string | null;
  dietary_notes: string | null;
  guest_group: string | null;
  notes: string | null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Validate + normalize a guest payload. `partial` allows PATCH callers to send
 * only the fields they want to change. Returns the sanitized subset or an error.
 */
export function sanitizeGuest(
  body: Record<string, unknown>,
  partial: boolean,
): { data: Partial<GuestInput> } | { error: string } {
  const out: Partial<GuestInput> = {};

  if (!partial || 'full_name' in body) {
    const name = str(body.full_name, 120);
    if (!name) return { error: 'full_name is required' };
    out.full_name = name;
  }
  if (!partial || 'email' in body) out.email = str(body.email, 200);
  if (!partial || 'phone' in body) out.phone = str(body.phone, 40);
  if (!partial || 'address' in body) out.address = str(body.address, 300);
  if (!partial || 'meal_choice' in body) out.meal_choice = str(body.meal_choice, 120);
  if (!partial || 'dietary_notes' in body) out.dietary_notes = str(body.dietary_notes, 500);
  if (!partial || 'guest_group' in body) out.guest_group = str(body.guest_group, 80);
  if (!partial || 'notes' in body) out.notes = str(body.notes, 500);

  if (!partial || 'party_size' in body) {
    const raw = Number(body.party_size);
    const size = Number.isFinite(raw) ? Math.round(raw) : 1;
    out.party_size = Math.min(30, Math.max(1, size || 1));
  }

  if (!partial || 'rsvp_status' in body) {
    const status = String(body.rsvp_status ?? 'pending');
    if (!RSVP_STATUSES.includes(status as RsvpStatus)) return { error: 'invalid rsvp_status' };
    out.rsvp_status = status as RsvpStatus;
  }

  return { data: out };
}

/** GET — the bride's guest list, meal options, and RSVP summary. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  const [{ data: guests }, { data: weddingRow }] = await Promise.all([
    supabaseAdmin
      .from('wedding_guests')
      .select(GUEST_COLUMNS)
      .eq('couple_wedding_id', link.id)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('couple_weddings').select('meal_options').eq('id', link.id).maybeSingle(),
  ]);

  const rows = (guests ?? []) as Array<Record<string, unknown>>;
  const mealOptions = ((weddingRow as { meal_options?: unknown } | null)?.meal_options ?? []) as string[];

  return NextResponse.json({
    guests: rows,
    mealOptions: Array.isArray(mealOptions) ? mealOptions : [],
    summary: summarizeWeddingGuests(rows as never),
  });
}

/** POST — add a guest to the bride's list. */
export async function POST(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const link = await getActiveCoupleWedding(user.id);
  if (!link || link.status !== 'linked') {
    return NextResponse.json({ error: 'Connect with your venue first.' }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = sanitizeGuest(body, false);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

  const { data: inserted, error } = await supabaseAdmin
    .from('wedding_guests')
    .insert({
      couple_wedding_id: link.id,
      couple_id: user.id,
      venue_id: link.venue_id,
      venue_customer_id: link.venue_customer_id,
      ...result.data,
    })
    .select(GUEST_COLUMNS)
    .single();

  if (error) {
    console.error('[couple/guests POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, guest: inserted });
}
