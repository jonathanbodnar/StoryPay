import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrCreatePricingGuideId } from '@/lib/pricing-guide';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value;
}

/** POST /api/listing/pricing-guide/accommodations */
export async function POST(req: Request) {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { body = {}; }

  let guideId: string;
  try { guideId = await getOrCreatePricingGuideId(venueId); }
  catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }

  const { data: maxRow } = await supabaseAdmin
    .from('venue_pricing_guide_accommodations')
    .select('position')
    .eq('pricing_guide_id', guideId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = typeof body.position === 'number'
    ? (body.position as number)
    : ((maxRow?.position as number | undefined) ?? -1) + 1;

  const { data, error } = await supabaseAdmin
    .from('venue_pricing_guide_accommodations')
    .insert({
      pricing_guide_id: guideId,
      name:        typeof body.name        === 'string' ? body.name        : null,
      description: typeof body.description === 'string' ? body.description : null,
      image_url:   typeof body.image_url   === 'string' ? body.image_url   : null,
      position: nextPosition,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[pricing-guide/accommodations POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ accommodation: data });
}
