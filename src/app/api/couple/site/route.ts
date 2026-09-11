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
  type CoupleSiteRow,
} from '@/lib/couple-sites';

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

  const [site, { data: profile }, wedding] = await Promise.all([
    getCoupleSiteByCoupleId(user.id),
    supabaseAdmin
      .from('couple_profiles')
      .select('first_name, last_name, display_name, wedding_date, instagram_url, facebook_url, tiktok_url, pinterest_url')
      .eq('id', user.id)
      .maybeSingle(),
    getActiveCoupleWedding(user.id),
  ]);

  return NextResponse.json({
    site,
    profile: profile ?? null,
    hasVenue: Boolean(wedding && wedding.status === 'linked'),
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
  if ('photo_url' in body) patch.photo_url = str(body.photo_url, 800);
  if ('cover_url' in body) patch.cover_url = str(body.cover_url, 800);
  if ('custom_links' in body) patch.custom_links = sanitizeCoupleSiteLinks(body.custom_links);

  for (const key of ['show_countdown', 'show_venue', 'show_guestbook', 'show_registry', 'guestbook_moderated'] as const) {
    if (key in body) patch[key] = Boolean(body[key]);
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
      return NextResponse.json({ ok: true, site: existing });
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

  return NextResponse.json({ ok: true, site: row });
}
