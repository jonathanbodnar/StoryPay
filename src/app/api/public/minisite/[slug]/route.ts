import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  COUPLE_SITE_COLUMNS,
  coupleDisplayName,
  publicCoupleSiteLinks,
  publicGallery,
  minisiteUnlockToken,
  type CoupleSiteRow,
} from '@/lib/couple-sites';

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
    .select('first_name, display_name, partner_first_name, wedding_date, instagram_url, facebook_url, tiktok_url, pinterest_url')
    .eq('id', site.couple_id)
    .maybeSingle();

  const p = (profile ?? {}) as {
    first_name?: string | null;
    display_name?: string | null;
    partner_first_name?: string | null;
    wedding_date?: string | null;
    instagram_url?: string | null;
    facebook_url?: string | null;
    tiktok_url?: string | null;
    pinterest_url?: string | null;
  };

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

  // Is the couple linked to a venue? Drives both the "Our Venue" card and
  // whether public "find your RSVP" is offered.
  const { data: link } = await supabaseAdmin
    .from('couple_weddings')
    .select('venue_id')
    .eq('couple_id', site.couple_id)
    .eq('status', 'linked')
    .order('linked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const venueId = (link as { venue_id?: string } | null)?.venue_id ?? null;
  const rsvpEnabled = Boolean(venueId);

  // Optional "Our Venue" card — uses public listing fields only.
  let venue: { name: string; city: string | null; state: string | null; coverUrl: string | null; listingUrl: string } | null = null;
  if (site.show_venue && venueId) {
    const { data: v } = await supabaseAdmin
      .from('venues')
      .select('slug, name, cover_image_url, location_city, location_state, is_published')
      .eq('id', venueId)
      .maybeSingle();
    const vv = v as {
      slug: string | null; name: string | null; cover_image_url: string | null;
      location_city: string | null; location_state: string | null; is_published: boolean | null;
    } | null;
    if (vv && vv.is_published && vv.slug) {
      venue = {
        name: vv.name ?? 'Our venue',
        city: vv.location_city,
        state: vv.location_state,
        coverUrl: vv.cover_image_url,
        listingUrl: `${DIRECTORY_SITE}/venue/${vv.slug}`,
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
    photoUrl: site.photo_url,
    coverUrl: site.cover_url,
    weddingDate: p.wedding_date ?? null,
    socials,
    customLinks: publicCoupleSiteLinks(site.custom_links),
    gallery: publicGallery(site.gallery),
    embedHtml: site.embed_enabled ? site.embed_html : null,
    embedTitle: site.embed_title,
    showCountdown: site.show_countdown,
    showGuestbook: site.show_guestbook,
    rsvpEnabled,
    venue,
  });
}
