import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { sanitizeGuest } from '../route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GUEST_COLUMNS =
  'id, full_name, email, phone, address, party_size, rsvp_status, meal_choice, dietary_notes, guest_group, notes, created_at, updated_at';

/**
 * Confirm the guest row belongs to the authenticated bride. Guests carry the
 * couple_id owner, so a simple ownership check is enough.
 */
async function assertOwnedGuest(guestId: string, coupleId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('wedding_guests')
    .select('id')
    .eq('id', guestId)
    .eq('couple_id', coupleId)
    .maybeSingle();
  return Boolean(data);
}

/** PATCH — update one of the bride's guests. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!(await assertOwnedGuest(id, user.id))) {
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

  const { data: updated, error } = await supabaseAdmin
    .from('wedding_guests')
    .update(result.data)
    .eq('id', id)
    .eq('couple_id', user.id)
    .select(GUEST_COLUMNS)
    .single();

  if (error) {
    console.error('[couple/guests PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, guest: updated });
}

/** DELETE — remove one of the bride's guests. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { error } = await supabaseAdmin
    .from('wedding_guests')
    .delete()
    .eq('id', id)
    .eq('couple_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
