import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { summarizeWeddingGuests } from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/venue/bride-portal/[weddingId]/guests
 *
 * Read-only guest rollup for a connected couple. The bride owns the guest list;
 * the venue sees planning fields (name, party size, RSVP, meal, dietary, group)
 * needed for headcount / catering / BEO — but NOT raw contact PII (email / phone
 * / address), which stays with the bride and the platform.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ weddingId: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { weddingId } = await params;

  // The wedding link must belong to this venue and be actively linked.
  const { data: link } = await supabaseAdmin
    .from('couple_weddings')
    .select('id, venue_id, status, meal_options')
    .eq('id', weddingId)
    .eq('venue_id', venueId)
    .maybeSingle();

  if (!link || (link as { status?: string }).status !== 'linked') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from('wedding_guests')
    .select('id, full_name, party_size, rsvp_status, meal_choice, dietary_notes, guest_group')
    .eq('couple_wedding_id', weddingId)
    .order('guest_group', { ascending: true })
    .order('full_name', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const guests = (rows ?? []) as Array<Record<string, unknown>>;
  const mealOptions = ((link as { meal_options?: unknown }).meal_options ?? []) as string[];

  return NextResponse.json({
    guests,
    mealOptions: Array.isArray(mealOptions) ? mealOptions : [],
    summary: summarizeWeddingGuests(guests as never),
  });
}
