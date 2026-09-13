import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveCoupleWeddingContext } from '@/lib/couple-server';
import { sanitizeGuest } from '../route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GUEST_COLUMNS =
  'id, full_name, email, phone, address, party_size, rsvp_status, meal_choice, dietary_notes, guest_group, notes, table_id, rsvp_token, invited_at, responded_at, invite_sent_count, created_at, updated_at';

/**
 * Confirm the guest row belongs to the caller's wedding. We scope by
 * couple_wedding_id (the wedding) rather than couple_id (the owner) so that
 * edit collaborators — who have a different user id than the owner — can manage
 * the same wedding's guests. The gate already proved this caller has write
 * access to that wedding.
 */
async function assertGuestInWedding(guestId: string, coupleWeddingId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('wedding_guests')
    .select('id')
    .eq('id', guestId)
    .eq('couple_wedding_id', coupleWeddingId)
    .maybeSingle();
  return Boolean(data);
}

/** PATCH — update one of the wedding's guests. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await resolveCoupleWeddingContext(request, { write: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const weddingId = gate.ctx.wedding.id;

  const { id } = await params;
  if (!(await assertGuestInWedding(id, weddingId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const result = sanitizeGuest(body, true);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  if (Object.keys(result.data).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }

  // If assigning to a table, make sure that table belongs to this wedding.
  if (result.data.table_id) {
    const { data: table } = await supabaseAdmin
      .from('wedding_tables')
      .select('id')
      .eq('id', result.data.table_id)
      .eq('couple_wedding_id', weddingId)
      .maybeSingle();
    if (!table) return NextResponse.json({ error: 'invalid table_id' }, { status: 400 });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('wedding_guests')
    .update(result.data)
    .eq('id', id)
    .eq('couple_wedding_id', weddingId)
    .select(GUEST_COLUMNS)
    .single();

  if (error) {
    console.error('[couple/guests PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, guest: updated });
}

/** DELETE — remove one of the wedding's guests. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await resolveCoupleWeddingContext(request, { write: true, requireLinked: true });
  if (!gate.ok) return gate.res;
  const weddingId = gate.ctx.wedding.id;

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from('wedding_guests')
    .delete()
    .eq('id', id)
    .eq('couple_wedding_id', weddingId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
