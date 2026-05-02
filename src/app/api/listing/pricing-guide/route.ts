import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function getVenueId() {
  const cookieStore = await cookies();
  return cookieStore.get('venue_id')?.value;
}

// Default empty guide row that the UI can render against on first load.
function emptyGuide(venueId: string) {
  return {
    venue_id: venueId,
    enabled: false,
    cover_image_url: null,
    cover_generated_at: null,
    cover_source_image_url: null,
    congratulatory_message: '',
    gallery: [] as { url: string; caption?: string }[],
    about_venue: '',
    accommodations_text: '',
    accommodations_image_url: null,
    pricing_intro: '',
    reviews: [] as { author?: string; location?: string; body?: string; rating?: number }[],
    availability_text: '',
    availability_image_url: null,
    cta_headline: '',
    cta_body: '',
    cta_button_label: 'Schedule a tour',
    spaces: [] as Array<{
      id: string;
      name: string | null;
      description: string | null;
      capacity: string | null;
      image_url: string | null;
      position: number;
    }>,
    packages: [] as Array<{
      id: string;
      name: string | null;
      price_label: string | null;
      description: string | null;
      included_items: string[];
      position: number;
    }>,
  };
}

/**
 * GET /api/listing/pricing-guide
 * Returns the current venue's pricing guide (creating it lazily) plus its
 * spaces and packages. Always returns a guide-shaped object — never 404s on
 * a venue that hasn't filled anything out yet.
 */
export async function GET() {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Try to load the parent row; if missing we return an empty shape so the
  // form can render and PATCH will lazily create on first save.
  const { data: guide, error: guideErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (guideErr && guideErr.code !== 'PGRST116') {
    console.error('[pricing-guide GET]', guideErr);
    return NextResponse.json({ error: guideErr.message }, { status: 500 });
  }

  if (!guide) {
    return NextResponse.json({ guide: emptyGuide(venueId) });
  }

  // Pull child rows in parallel
  const [spacesRes, packagesRes] = await Promise.all([
    supabaseAdmin
      .from('venue_pricing_guide_spaces')
      .select('*')
      .eq('pricing_guide_id', guide.id)
      .order('position', { ascending: true }),
    supabaseAdmin
      .from('venue_pricing_guide_packages')
      .select('*')
      .eq('pricing_guide_id', guide.id)
      .order('position', { ascending: true }),
  ]);

  return NextResponse.json({
    guide: {
      ...guide,
      spaces: spacesRes.data ?? [],
      packages: packagesRes.data ?? [],
    },
  });
}

const ALLOWED_PATCH_FIELDS = new Set([
  'enabled',
  'cover_image_url',
  'cover_generated_at',
  'cover_source_image_url',
  'congratulatory_message',
  'gallery',
  'about_venue',
  'accommodations_text',
  'accommodations_image_url',
  'pricing_intro',
  'reviews',
  'availability_text',
  'availability_image_url',
  'cta_headline',
  'cta_body',
  'cta_button_label',
]);

/**
 * PATCH /api/listing/pricing-guide
 * Upsert the parent guide row. Only fields in ALLOWED_PATCH_FIELDS are
 * accepted; anything else is silently dropped. Returns the saved row.
 */
export async function PATCH(req: Request) {
  const venueId = await getVenueId();
  if (!venueId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_PATCH_FIELDS.has(k)) update[k] = v;
  }
  update.updated_at = new Date().toISOString();

  // Look up an existing row first so we can decide insert vs update.
  const { data: existing } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('id')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('venue_pricing_guides')
      .update(update)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) {
      console.error('[pricing-guide PATCH update]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ guide: data });
  }

  // First-time save — insert a new row.
  const { data, error } = await supabaseAdmin
    .from('venue_pricing_guides')
    .insert({ venue_id: venueId, ...update })
    .select('*')
    .single();

  if (error) {
    console.error('[pricing-guide PATCH insert]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ guide: data });
}
