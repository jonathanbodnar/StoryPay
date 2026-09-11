import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getVenueId } from '@/lib/auth-helpers';
import { type CoupleWeddingRow } from '@/lib/couple-weddings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/venue/wedding-hub/decide
 * Body: { id: string, action: 'approve' | 'deny' }
 * Venue approves or denies a bride-initiated connection request.
 */
export async function POST(request: NextRequest) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = (body.id ?? '').trim();
  const action = body.action;
  if (!id || (action !== 'approve' && action !== 'deny')) {
    return NextResponse.json({ error: 'id and a valid action are required' }, { status: 400 });
  }

  const { data: rowData } = await supabaseAdmin
    .from('couple_weddings')
    .select('*')
    .eq('id', id)
    .eq('venue_id', venueId)
    .maybeSingle();
  const row = rowData as CoupleWeddingRow | null;
  if (!row || row.status !== 'pending' || row.initiated_by !== 'bride') {
    return NextResponse.json({ error: 'Request not found or already handled.' }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (action === 'deny') {
    const { error } = await supabaseAdmin
      .from('couple_weddings')
      .update({ status: 'declined', decided_at: now })
      .eq('id', id)
      .eq('venue_id', venueId)
      .eq('status', 'pending');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Approve — resolve or create the booked-customer record to hang the thread on.
  let venueCustomerId = row.venue_customer_id;
  if (!venueCustomerId) {
    const email = (row.invited_email ?? '').trim().toLowerCase();
    if (email) {
      const { data: vc } = await supabaseAdmin
        .from('venue_customers')
        .select('id')
        .eq('venue_id', venueId)
        .ilike('customer_email', email)
        .maybeSingle();
      venueCustomerId = (vc as { id?: string } | null)?.id ?? null;
    }
    if (!venueCustomerId) {
      const [fn, ...rest] = (row.invited_name ?? '').trim().split(/\s+/).filter(Boolean);
      const { data: created, error: vcErr } = await supabaseAdmin
        .from('venue_customers')
        .insert({
          venue_id: venueId,
          customer_email: email || `couple.${row.id}@bride-portal.storyvenue.placeholder`,
          first_name: fn || null,
          last_name: rest.join(' ') || null,
        })
        .select('id')
        .single();
      if (vcErr || !created) {
        console.error('[bride-portal/decide] create vc', vcErr);
        return NextResponse.json({ error: 'Could not create the contact record.' }, { status: 500 });
      }
      venueCustomerId = (created as { id: string }).id;
    }
  }

  // Guard: this booked customer must not already be linked to a different couple.
  const { data: conflict } = await supabaseAdmin
    .from('couple_weddings')
    .select('id')
    .eq('venue_id', venueId)
    .eq('venue_customer_id', venueCustomerId)
    .eq('status', 'linked')
    .neq('id', id)
    .maybeSingle();
  if (conflict) {
    return NextResponse.json(
      { error: 'That contact is already connected to another couple account.' },
      { status: 409 },
    );
  }

  const { error: updErr } = await supabaseAdmin
    .from('couple_weddings')
    .update({ status: 'linked', venue_customer_id: venueCustomerId, linked_at: now, decided_at: now })
    .eq('id', id)
    .eq('venue_id', venueId)
    .eq('status', 'pending');
  if (updErr) {
    console.error('[bride-portal/decide] approve', updErr);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
