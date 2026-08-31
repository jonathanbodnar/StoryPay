export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { hasAdminTabAccess } from '@/lib/admin-identity';
import { getVenueAdData } from '@/lib/ad-generator/venue-data';
import { prepareLogo } from '@/lib/ad-generator/images';
import { renderAdCreative } from '@/lib/ad-generator/render';
import { TEMPLATE_SLOTS } from '@/lib/ad-generator/templates';
import { AD_CTA, type AdCopyVariant, type TemplateKey } from '@/lib/ad-generator/spec';

const FALLBACK_HERO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * POST { venueId, templateKey, headline, bullets[], imageCta?, slotImages[] }
 * → re-render a single creative with the operator's edited on-image text, reusing
 *   the already-cropped slot photos. Returns a fresh PNG data URI to download.
 */
export async function POST(request: NextRequest) {
  if (!(await hasAdminTabAccess('projects'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    venueId?: string;
    templateKey?: string;
    headline?: string;
    bullets?: unknown;
    imageCta?: string;
    primaryText?: string;
    metaHeadline?: string;
    slotImages?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venueId = (body.venueId || '').trim();
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 });

  const templateKey: TemplateKey = body.templateKey === 'pricing' ? 'pricing' : 'editorial';
  const bullets = Array.isArray(body.bullets)
    ? body.bullets.map((b) => String(b)).filter(Boolean).slice(0, 8)
    : [];
  const slotImagesIn = Array.isArray(body.slotImages)
    ? body.slotImages.map((s) => String(s)).filter(Boolean)
    : [];

  const data = await getVenueAdData(venueId);
  if (!data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  const logoDataUrl = data.logoUrl ? await prepareLogo(data.logoUrl, 300, 112) : null;

  // Ensure exactly one image per slot (client normally sends the exact set back).
  const slotCount = (TEMPLATE_SLOTS[templateKey] ?? TEMPLATE_SLOTS.editorial).length;
  const images: string[] = [];
  for (let i = 0; i < slotCount; i++) images.push(slotImagesIn[i] || FALLBACK_HERO);

  const variant: AdCopyVariant = {
    templateKey,
    imageHeadline: (body.headline || '').trim() || 'Your Dream Day Awaits',
    imageBullets: bullets,
    imageCta: (body.imageCta || '').trim() || 'Download the pricing guide',
    kicker: '',
    primaryText: (body.primaryText || '').trim() || AD_CTA,
    metaHeadline: (body.metaHeadline || '').trim() || 'Free pricing & availability guide',
  };

  try {
    const png = await renderAdCreative(templateKey, { venue: data, variant, images, logoDataUrl });
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    return NextResponse.json({ image: dataUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[admin/ad-generator/render]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
