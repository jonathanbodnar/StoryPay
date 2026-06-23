/**
 * GET  /api/onboarding/state  — current wizard state for the logged-in venue.
 * POST /api/onboarding/state  — advance step, or publish (the activation moment).
 *
 * Publish = flip the guide live (enabled) + publish the listing (is_published)
 * + stamp onboarding_completed_at, then return the live directory URL with which
 * the wizard shows the copy/share affordance.
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrCreatePricingGuideId } from '@/lib/pricing-guide';
import { slugify } from '@/lib/directory';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DIRECTORY_URL = (process.env.NEXT_PUBLIC_DIRECTORY_URL || 'https://storyvenue.com').replace(/\/$/, '');

async function getVenueId(): Promise<string | null> {
  const c = await cookies();
  return c.get('venue_id')?.value ?? null;
}

function liveUrl(slug: string | null): string | null {
  return slug ? `${DIRECTORY_URL}/venue/${slug}` : null;
}

/**
 * Ensures the venue has a unique slug so it can have a public URL. New signups
 * are created without one. Returns the existing or newly-assigned slug.
 */
async function ensureVenueSlug(venueId: string, name: string | null): Promise<string | null> {
  const base = slugify(name || '') || `venue-${venueId.slice(0, 8)}`;
  let candidate = base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: clash } = await supabaseAdmin
      .from('venues')
      .select('id')
      .eq('slug', candidate)
      .neq('id', venueId)
      .maybeSingle();
    if (!clash) break;
    candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const { error } = await supabaseAdmin
    .from('venues')
    .update({ slug: candidate })
    .eq('id', venueId);
  if (error) {
    console.error('[onboarding] ensureVenueSlug', error.message);
    return null;
  }
  return candidate;
}

export async function GET(): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: venue } = await supabaseAdmin
    .from('venues')
    .select('slug, is_published, onboarding_completed_at, onboarding_last_step')
    .eq('id', venueId)
    .maybeSingle();

  const { data: guide } = await supabaseAdmin
    .from('venue_pricing_guides')
    .select('enabled')
    .eq('venue_id', venueId)
    .maybeSingle();

  const v = (venue ?? {}) as Record<string, unknown>;
  return NextResponse.json({
    completed: Boolean(v.onboarding_completed_at),
    last_step: typeof v.onboarding_last_step === 'number' ? v.onboarding_last_step : 0,
    is_published: Boolean(v.is_published),
    guide_enabled: Boolean((guide as { enabled?: boolean } | null)?.enabled),
    slug: (v.slug as string) ?? null,
    live_url: liveUrl((v.slug as string) ?? null),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const venueId = await getVenueId();
  if (!venueId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = String(body.action ?? 'step');

  if (action === 'step') {
    const step = Number(body.step);
    if (!Number.isFinite(step)) {
      return NextResponse.json({ error: 'step must be a number' }, { status: 400 });
    }
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_last_step: Math.max(0, Math.min(9, Math.round(step))) })
      .eq('id', venueId);
    return NextResponse.json({ ok: true });
  }

  if (action === 'publish') {
    // 1. Flip the guide live.
    const guideId = await getOrCreatePricingGuideId(venueId);
    const { error: guideErr } = await supabaseAdmin
      .from('venue_pricing_guides')
      .update({ enabled: true, updated_at: new Date().toISOString() })
      .eq('id', guideId);
    if (guideErr) {
      console.error('[onboarding/publish] guide enable', guideErr.message);
      return NextResponse.json({ error: guideErr.message }, { status: 500 });
    }

    // 2. Make sure the venue has a slug — new signups don't get one, and
    //    without it there's no public URL (the success screen needs one).
    const { data: current } = await supabaseAdmin
      .from('venues')
      .select('slug, name')
      .eq('id', venueId)
      .maybeSingle();

    let slug = (current?.slug as string | null) ?? null;
    if (!slug) {
      slug = await ensureVenueSlug(venueId, (current?.name as string) ?? null);
    }

    // 3. Publish the listing + stamp activation.
    const { error: vErr } = await supabaseAdmin
      .from('venues')
      .update({
        is_published: true,
        onboarding_completed_at: new Date().toISOString(),
        onboarding_last_step: 3,
      })
      .eq('id', venueId);
    if (vErr) {
      console.error('[onboarding/publish] venue publish', vErr.message);
      return NextResponse.json({ error: vErr.message }, { status: 500 });
    }

    // Analytics milestone — the one metric we optimize for.
    void import('@/lib/analytics')
      .then(({ trackMilestone }) => {
        trackMilestone('guide_published', { venueId, label: 'Onboarding: guide published' });
      })
      .catch(() => { /* non-fatal */ });

    return NextResponse.json({ ok: true, is_published: true, slug, live_url: liveUrl(slug) });
  }

  if (action === 'restart') {
    // Re-open the wizard from the top. Leaves the listing published (we don't
    // un-publish a live page) but clears the completion stamp so it shows again.
    await supabaseAdmin
      .from('venues')
      .update({ onboarding_completed_at: null, onboarding_last_step: 0 })
      .eq('id', venueId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
