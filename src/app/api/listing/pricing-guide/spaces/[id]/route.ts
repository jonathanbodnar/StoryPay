import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { childBelongsToVenue } from '@/lib/pricing-guide';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value;
}

const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'capacity',
  'image_url',
  'position',
]);

/**
 * PATCH /api/listing/pricing-guide/spaces/[id]
 * Update a space row. Only fields in ALLOWED_FIELDS are accepted. Verifies
 * the space belongs to the requesting venue's guide before writing.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const owns = await childBelongsToVenue('venue_pricing_guide_spaces', id, venueId);
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* empty patch is fine */ }

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_FIELDS.has(k)) update[k] = v;
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('venue_pricing_guide_spaces')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('[pricing-guide/spaces PATCH]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ space: data });
}

/**
 * DELETE /api/listing/pricing-guide/spaces/[id]
 * Permanently removes a space row. Verifies ownership first.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const owns = await childBelongsToVenue('venue_pricing_guide_spaces', id, venueId);
  if (!owns) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await supabaseAdmin
    .from('venue_pricing_guide_spaces')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[pricing-guide/spaces DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
