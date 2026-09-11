import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import {
  getVenueBridePortalConfig,
  summarizeWeddingGuests,
  type CoupleWeddingRow,
  type WeddingGuestSummary,
} from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: rows, error } = await supabaseAdmin
    .from('couple_weddings')
    .select('*')
    .eq('venue_id', venueId)
    .in('status', ['pending', 'linked'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[venue/bride-portal GET]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const all = (rows ?? []) as CoupleWeddingRow[];

  // Resolve display info for matched venue_customers (wedding date etc.).
  const vcIds = [...new Set(all.map((r) => r.venue_customer_id).filter((x): x is string => !!x))];
  const vcById = new Map<string, { first_name: string | null; last_name: string | null; customer_email: string | null; wedding_date: string | null }>();
  if (vcIds.length) {
    const { data: vcs } = await supabaseAdmin
      .from('venue_customers')
      .select('id, first_name, last_name, customer_email, wedding_date')
      .eq('venue_id', venueId)
      .in('id', vcIds);
    for (const vc of vcs ?? []) {
      const r = vc as { id: string; first_name: string | null; last_name: string | null; customer_email: string | null; wedding_date: string | null };
      vcById.set(r.id, { first_name: r.first_name, last_name: r.last_name, customer_email: r.customer_email, wedding_date: r.wedding_date });
    }
  }

  function displayFor(r: CoupleWeddingRow) {
    const vc = r.venue_customer_id ? vcById.get(r.venue_customer_id) : undefined;
    const vcName = vc ? [vc.first_name, vc.last_name].filter(Boolean).join(' ').trim() : '';
    const name = r.invited_name?.trim() || vcName || null;
    const email = r.invited_email?.trim() || vc?.customer_email || null;
    return { name, email, wedding_date: vc?.wedding_date ?? null };
  }

  // Guest-list rollup per linked couple (headcount + RSVP counts).
  const linkedIds = all.filter((r) => r.status === 'linked').map((r) => r.id);
  const guestSummaryByWedding = new Map<string, WeddingGuestSummary>();
  if (linkedIds.length) {
    const { data: guestRows } = await supabaseAdmin
      .from('wedding_guests')
      .select('couple_wedding_id, rsvp_status, party_size, meal_choice')
      .in('couple_wedding_id', linkedIds);
    const grouped = new Map<string, Array<{ rsvp_status: string | null; party_size: number | null; meal_choice: string | null }>>();
    for (const g of (guestRows ?? []) as Array<{ couple_wedding_id: string; rsvp_status: string | null; party_size: number | null; meal_choice: string | null }>) {
      const arr = grouped.get(g.couple_wedding_id) ?? [];
      arr.push({ rsvp_status: g.rsvp_status, party_size: g.party_size, meal_choice: g.meal_choice });
      grouped.set(g.couple_wedding_id, arr);
    }
    for (const id of linkedIds) {
      guestSummaryByWedding.set(id, summarizeWeddingGuests(grouped.get(id) ?? []));
    }
  }

  const { enabled, visibility } = await getVenueBridePortalConfig(venueId);

  const requests = all
    .filter((r) => r.status === 'pending' && r.initiated_by === 'bride')
    .map((r) => {
      const d = displayFor(r);
      return {
        id: r.id,
        name: d.name,
        email: d.email,
        message: r.request_message,
        wedding_date: d.wedding_date,
        matched: !!r.venue_customer_id,
        requested_at: r.created_at,
      };
    });

  const links = all.map((r) => {
    const d = displayFor(r);
    return {
      id: r.id,
      status: r.status,
      initiated_by: r.initiated_by,
      name: d.name,
      email: d.email,
      wedding_date: d.wedding_date,
      created_at: r.created_at,
      linked_at: r.linked_at,
      // A venue-initiated pending row is an outstanding invite awaiting the bride.
      pending_kind: r.status === 'pending' ? (r.initiated_by === 'venue' ? 'invite_sent' : 'request') : null,
      guests: r.status === 'linked' ? guestSummaryByWedding.get(r.id) ?? null : null,
    };
  });

  return NextResponse.json({ requests, links, enabled, visibility });
}
