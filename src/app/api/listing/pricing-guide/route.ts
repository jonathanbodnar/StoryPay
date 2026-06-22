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
    use_custom_pricing_guide: false,
    custom_pricing_guide_url: null,
    cover_image_url: null,
    cover_generated_at: null,
    cover_source_image_url: null,
    congratulatory_message: '',
    gallery: [] as { url: string; caption?: string }[],
    about_venue: '',
    about_photos: [] as { url: string; caption?: string }[],
    accommodations_photos: [] as { url: string; caption?: string }[],
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
    accommodations: [] as Array<{
      id: string;
      name: string | null;
      description: string | null;
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

  // Try to load the parent row; if the table doesn't exist yet (migration
  // 091 not applied) or no row exists for this venue, return an empty shape
  // so the form still renders. The PATCH handler will lazily create on first
  // save once the schema is in place.
  const { data: guide, error: guideErr } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('*')
    .eq('venue_id', venueId)
    .maybeSingle();

  if (guideErr) {
    // Tolerate "row not found" (PGRST116) and "undefined table" (42P01) —
    // both mean the user hasn't done anything yet.
    const code = (guideErr as { code?: string }).code;
    if (code !== 'PGRST116' && code !== '42P01') {
      console.error('[pricing-guide GET]', guideErr);
      return NextResponse.json({ error: guideErr.message }, { status: 500 });
    }
    return NextResponse.json({ guide: emptyGuide(venueId), schemaMissing: code === '42P01' });
  }

  if (!guide) {
    return NextResponse.json({ guide: emptyGuide(venueId) });
  }

  // Pull child rows in parallel
  const [spacesRes, packagesRes, accommodationsRes] = await Promise.all([
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
    supabaseAdmin
      .from('venue_pricing_guide_accommodations')
      .select('*')
      .eq('pricing_guide_id', guide.id)
      .order('position', { ascending: true }),
  ]);

  return NextResponse.json({
    guide: {
      ...guide,
      spaces: spacesRes.data ?? [],
      packages: packagesRes.data ?? [],
      accommodations: accommodationsRes.data ?? [],
    },
  });
}

const ALLOWED_PATCH_FIELDS = new Set([
  'enabled',
  'use_custom_pricing_guide',
  'custom_pricing_guide_url',
  'cover_image_url',
  'cover_generated_at',
  'cover_source_image_url',
  'congratulatory_message',
  'gallery',
  'about_venue',
  'about_photos',
  'accommodations_text',
  'accommodations_photos',
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

  // Single round-trip upsert keyed on the unique `venue_id` column.  This
  // avoids a select+insert race where two concurrent saves could both decide
  // "no row exists" and try to insert.  It also gives us a single, clear
  // error path when the schema is missing or RLS blocks writes.
  const { data, error } = await supabaseAdmin
    .from('venue_pricing_guides')
    .upsert({ venue_id: venueId, ...update }, { onConflict: 'venue_id' })
    .select('*')
    .single();

  if (error) {
    console.error('[pricing-guide PATCH upsert]', { error, venueId, keys: Object.keys(update) });
    return NextResponse.json(
      { error: error.message, code: (error as { code?: string }).code ?? null },
      { status: 500 },
    );
  }

  // Analytics: funnel milestones — first time this venue saves a guide
  // (guide_created) and first time it's published (guide_published).
  void import('@/lib/analytics')
    .then(({ trackMilestone }) => {
      trackMilestone('guide_created', { venueId, label: 'Pricing guide started' });
      if (update.enabled === true) {
        trackMilestone('guide_published', { venueId, label: 'Pricing guide published' });
      }
    })
    .catch(() => { /* non-fatal */ });

  return NextResponse.json({ guide: data });
}
