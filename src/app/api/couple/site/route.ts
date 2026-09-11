import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getCoupleAuthUser } from '@/lib/couple-server';
import { getActiveCoupleWedding } from '@/lib/couple-weddings';
import {
  COUPLE_SITE_COLUMNS,
  getCoupleSiteByCoupleId,
  isCoupleSlugTaken,
  normalizeCoupleSlug,
  sanitizeCoupleSiteLinks,
  sanitizeGallery,
  sanitizeEmbedHtml,
  sanitizeEmbedMode,
  sanitizeSectionOrder,
  hashSitePassword,
  isSiteExpired,
  releaseExpiredSite,
  type CoupleSiteRow,
} from '@/lib/couple-sites';
import { sanitizeStoryHtml, storyHtmlToPlain } from '@/lib/sanitize-story';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DIRECTORY_SITE = (
  process.env.NEXT_PUBLIC_DIRECTORY_SITE_URL ||
  process.env.NEXT_PUBLIC_DIRECTORY_URL ||
  'https://storyvenue.com'
).replace(/\/$/, '');

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

/** GET — the bride's minisite (or sensible defaults) + profile-derived preview data. */
export async function GET(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [siteInitial, { data: profile }, wedding] = await Promise.all([
    getCoupleSiteByCoupleId(user.id),
    supabaseAdmin
      .from('couple_profiles')
      .select('first_name, last_name, display_name, partner_first_name, partner_last_name, wedding_date, instagram_url, facebook_url, tiktok_url, pinterest_url')
      .eq('id', user.id)
      .maybeSingle(),
    getActiveCoupleWedding(user.id),
  ]);

  // Auto-close: once 30+ days past the wedding, unpublish + release the slug so
  // it reflects as closed when the couple opens the editor (content is kept).
  let site = siteInitial;
  const weddingDate = (profile as { wedding_date?: string | null } | null)?.wedding_date ?? null;
  if (site && (site.is_published || site.slug) && isSiteExpired(weddingDate)) {
    await releaseExpiredSite(user.id);
    site = await getCoupleSiteByCoupleId(user.id);
  }

  let hasPassword = false;
  if (site) {
    const { data: pw } = await supabaseAdmin
      .from('couple_sites')
      .select('site_password_hash')
      .eq('couple_id', user.id)
      .maybeSingle();
    hasPassword = Boolean((pw as { site_password_hash?: string | null } | null)?.site_password_hash);
  }

  return NextResponse.json({
    site,
    profile: profile ?? null,
    hasVenue: Boolean(wedding && wedding.status === 'linked'),
    hasPassword,
    publicBaseUrl: DIRECTORY_SITE,
  });
}

/** PUT — create/update the bride's minisite. */
export async function PUT(request: NextRequest) {
  const user = await getCoupleAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  // Slug — optional until publish, must be unique + not reserved.
  if ('slug' in body) {
    const raw = body.slug;
    if (raw === null || raw === '') {
      patch.slug = null;
    } else {
      const slug = normalizeCoupleSlug(raw);
      if (!slug) {
        return NextResponse.json(
          { error: 'That link is not available. Use at least 3 letters/numbers and avoid reserved words.' },
          { status: 400 },
        );
      }
      if (await isCoupleSlugTaken(slug, user.id)) {
        return NextResponse.json({ error: 'That link is already taken. Try another.' }, { status: 409 });
      }
      patch.slug = slug;
    }
  }

  if ('headline' in body) patch.headline = str(body.headline, 120);
  if ('partner_name' in body) patch.partner_name = str(body.partner_name, 80);
  if ('story' in body) patch.story = str(body.story, 4000);

  // Rich story: sanitize HTML and keep the plain `story` column in sync so
  // previews/metadata (and old readers) keep working.
  if ('story_html' in body) {
    const cleanHtml = sanitizeStoryHtml(body.story_html);
    patch.story_html = cleanHtml;
    patch.story = storyHtmlToPlain(cleanHtml);
  }

  if ('section_order' in body) patch.section_order = sanitizeSectionOrder(body.section_order);
  if ('photo_url' in body) patch.photo_url = str(body.photo_url, 800);
  if ('cover_url' in body) patch.cover_url = str(body.cover_url, 800);
  if ('custom_links' in body) patch.custom_links = sanitizeCoupleSiteLinks(body.custom_links);
  if ('gallery' in body) patch.gallery = sanitizeGallery(body.gallery);

  // Embed (livestream / special element) — only a rebuilt https iframe is stored.
  if ('embed_html' in body) patch.embed_html = sanitizeEmbedHtml(body.embed_html);
  if ('embed_title' in body) patch.embed_title = str(body.embed_title, 80);
  if ('embed_mode' in body) patch.embed_mode = sanitizeEmbedMode(body.embed_mode);

  for (const key of ['show_countdown', 'show_venue', 'show_guestbook', 'show_registry', 'guestbook_moderated', 'embed_enabled'] as const) {
    if (key in body) patch[key] = Boolean(body[key]);
  }

  // Optional private password gate. Non-empty string sets it; null/'' clears it.
  if ('site_password' in body) {
    const raw = body.site_password;
    if (raw === null || raw === '') {
      patch.site_password_hash = null;
    } else if (typeof raw === 'string' && raw.length >= 3) {
      patch.site_password_hash = hashSitePassword(raw.slice(0, 128));
    } else {
      return NextResponse.json({ error: 'Password must be at least 3 characters.' }, { status: 400 });
    }
  }

  // Publish gate: require a slug before going live.
  const existing = await getCoupleSiteByCoupleId(user.id);
  if ('is_published' in body) {
    const wantPublish = Boolean(body.is_published);
    if (wantPublish) {
      const effectiveSlug = ('slug' in patch ? patch.slug : existing?.slug) as string | null;
      if (!effectiveSlug) {
        return NextResponse.json({ error: 'Choose your link before publishing.' }, { status: 400 });
      }
    }
    patch.is_published = wantPublish;
  }

  async function currentHasPassword(): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from('couple_sites')
      .select('site_password_hash')
      .eq('couple_id', user!.id)
      .maybeSingle();
    return Boolean((data as { site_password_hash?: string | null } | null)?.site_password_hash);
  }

  let row: CoupleSiteRow | null;
  if (!existing) {
    const { data, error } = await supabaseAdmin
      .from('couple_sites')
      .insert({ couple_id: user.id, ...patch })
      .select(COUPLE_SITE_COLUMNS)
      .single();
    if (error) {
      console.error('[couple/site PUT insert]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    row = data as CoupleSiteRow;
  } else {
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, site: existing, hasPassword: await currentHasPassword() });
    }
    const { data, error } = await supabaseAdmin
      .from('couple_sites')
      .update(patch)
      .eq('couple_id', user.id)
      .select(COUPLE_SITE_COLUMNS)
      .single();
    if (error) {
      console.error('[couple/site PUT update]', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    row = data as CoupleSiteRow;
  }

  return NextResponse.json({ ok: true, site: row, hasPassword: await currentHasPassword() });
}
