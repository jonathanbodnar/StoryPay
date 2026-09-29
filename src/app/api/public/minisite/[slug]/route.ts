import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  COUPLE_SITE_COLUMNS,
  coupleDisplayName,
  publicCoupleSiteLinks,
  publicGallery,
  publicRegistryItems,
  minisiteUnlockToken,
  sanitizeSectionOrder,
  isSiteExpired,
  releaseExpiredSite,
  type CoupleSiteRow,
} from '@/lib/couple-sites';

function venueMapsUrl(name: string | null, address: string | null, city: string | null, state: string | null): string {
  const dest = [name, address || [city, state].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DIRECTORY_SITE = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  process.env.NEXT_PUBLIC_DIRECTORY_URL ||
  'https://storyvenue.com'
).replace(/\/$/, '');

/**
 * Public, no-login read for a bride's wedding minisite. Returns ONLY published,
 * bride-approved display fields — never guest data. Consumed server-side by the
 * weddingdirectory app that renders storyvenue.com/<slug>.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug || slug.length > 90) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: siteRow } = await supabaseAdmin
    .from('couple_sites')
    .select(`${COUPLE_SITE_COLUMNS}, site_password_hash`)
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();

  const site = siteRow as (CoupleSiteRow & { site_password_hash?: string | null }) | null;
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: profile } = await supabaseAdmin
    .from('couple_profiles')
    .select('first_name, display_name, partner_first_name, wedding_date, wedding_time, instagram_url, facebook_url, tiktok_url, pinterest_url')
    .eq('id', site.couple_id)
    .maybeSingle();

  const p = (profile ?? {}) as {
    first_name?: string | null;
    display_name?: string | null;
    partner_first_name?: string | null;
    wedding_date?: string | null;
    wedding_time?: string | null;
    instagram_url?: string | null;
    facebook_url?: string | null;
    tiktok_url?: string | null;
    pinterest_url?: string | null;
  };

  // Auto-close: 30+ days after the wedding the site unpublishes and its slug is
  // released. Enforce lazily here so an expired link stops resolving (and frees
  // up) the first time it's hit after the window.
  if (isSiteExpired(p.wedding_date ?? null)) {
    await releaseExpiredSite(site.couple_id);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const coupleName = coupleDisplayName(p, site.partner_name);

  // ── Optional password gate ────────────────────────────────────────────────
  // When a password is set, return ONLY the couple name + a locked flag until
  // the caller presents a valid unlock token (?k=), so private details never
  // leave the server for the wrong visitor.
  const passwordHash = site.site_password_hash ?? null;
  if (passwordHash) {
    const provided = req.nextUrl.searchParams.get('k') ?? '';
    const expected = minisiteUnlockToken(slug, passwordHash);
    const ok = provided.length === expected.length && provided === expected;
    if (!ok) {
      return NextResponse.json({ locked: true, slug: site.slug, coupleName });
    }
  }

  // Count the visit (shown on the couple's planner home). Best-effort.
  void supabaseAdmin.rpc('increment_couple_site_view', { p_site_id: site.id }).then(({ error }) => {
    if (error) console.warn('[minisite] view count failed:', error.message);
  });

  // The couple's Wedding Planner: "find your RSVP" works whenever they have a
  // guest list (with or without a venue); the "Our Venue" card needs a
  // connected venue.
  const { data: planner } = await supabaseAdmin
    .from('couple_weddings')
    .select('venue_id, status')
    .eq('couple_id', site.couple_id)
    .in('status', ['linked', 'pending', 'self'])
    .order('status', { ascending: true }) // linked first
    .limit(1)
    .maybeSingle();
  const plannerRow = planner as { venue_id?: string | null; status?: string } | null;
  const venueId = plannerRow?.status === 'linked' ? plannerRow.venue_id ?? null : null;
  const rsvpEnabled = Boolean(plannerRow);

  // Optional "Our Venue" card — uses public listing fields only.
  let venue: {
    name: string; city: string | null; state: string | null; address: string | null;
    coverUrl: string | null; listingUrl: string; mapsUrl: string;
  } | null = null;
  if (site.show_venue && venueId) {
    const { data: v } = await supabaseAdmin
      .from('venues')
      .select('slug, name, cover_image_url, location_city, location_state, location_full, is_published')
      .eq('id', venueId)
      .maybeSingle();
    const vv = v as {
      slug: string | null; name: string | null; cover_image_url: string | null;
      location_city: string | null; location_state: string | null; location_full: string | null; is_published: boolean | null;
    } | null;
    if (vv && vv.is_published && vv.slug) {
      const address = vv.location_full || [vv.location_city, vv.location_state].filter(Boolean).join(', ') || null;
      venue = {
        name: vv.name ?? 'Our venue',
        city: vv.location_city,
        state: vv.location_state,
        address,
        coverUrl: vv.cover_image_url,
        listingUrl: `${DIRECTORY_SITE}/venue/${vv.slug}`,
        mapsUrl: venueMapsUrl(vv.name, vv.location_full, vv.location_city, vv.location_state),
      };
    }
  }

  const socials = {
    instagram: p.instagram_url || null,
    facebook: p.facebook_url || null,
    tiktok: p.tiktok_url || null,
    pinterest: p.pinterest_url || null,
  };

  return NextResponse.json({
    locked: false,
    slug: site.slug,
    coupleName,
    headline: site.headline,
    story: site.story,
    storyHtml: site.story_html ?? null,
    photoUrl: site.photo_url,
    coverUrl: site.cover_url,
    weddingDate: p.wedding_date ?? null,
    weddingTime: p.wedding_time ?? null,
    socials,
    customLinks: publicCoupleSiteLinks(site.custom_links),
    gallery: publicGallery(site.gallery),
    showRegistry: site.show_registry,
    registryItems: site.show_registry ? publicRegistryItems(site.registry_items) : [],
    embedHtml: site.embed_enabled ? site.embed_html : null,
    embedTitle: site.embed_title,
    embedMode: site.embed_mode === 'live' ? 'live' : 'page',
    sectionOrder: sanitizeSectionOrder(site.section_order),
    showCountdown: site.show_countdown,
    showGuestbook: site.show_guestbook,
    rsvpEnabled,
    venue,
  });
}
