import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { summarizeWeddingGuests } from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/venue/wedding-hub/[weddingId]/guests
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

  const [{ data: rows, error }, { data: tableRows }] = await Promise.all([
    supabaseAdmin
      .from('wedding_guests')
      .select('id, full_name, party_size, rsvp_status, meal_choice, dietary_notes, guest_group, table_id')
      .eq('couple_wedding_id', weddingId)
      .order('guest_group', { ascending: true })
      .order('full_name', { ascending: true }),
    supabaseAdmin
      .from('wedding_tables')
      .select('id, name, capacity, sort_order')
      .eq('couple_wedding_id', weddingId)
      .order('sort_order', { ascending: true }),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const guests = (rows ?? []) as Array<Record<string, unknown>>;
  const mealOptions = ((link as { meal_options?: unknown }).meal_options ?? []) as string[];

  // Aggregate seated headcount per table (party_size sum) so the venue can plan
  // the room layout without touching guest contact PII.
  const tables = ((tableRows ?? []) as Array<{ id: string; name: string; capacity: number; sort_order: number }>).map(
    (t) => {
      let seated = 0;
      let parties = 0;
      for (const g of guests) {
        if ((g as { table_id?: string | null }).table_id === t.id) {
          parties += 1;
          seated += Math.max(1, Number((g as { party_size?: number }).party_size) || 1);
        }
      }
      return { id: t.id, name: t.name, capacity: t.capacity, seated, parties };
    },
  );

  return NextResponse.json({
    guests,
    tables,
    mealOptions: Array.isArray(mealOptions) ? mealOptions : [],
    summary: summarizeWeddingGuests(guests as never),
  });
}
