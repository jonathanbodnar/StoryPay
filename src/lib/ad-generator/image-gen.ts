/**
 * AI ad-image generation via OpenAI's gpt-image-2.
 *
 * Unlike the Satori template path (which composites real photos into a fixed
 * layout), this asks the image model to *design* a magazine-style portrait
 * wedding ad. We feed the venue's real photos (and logo) as reference images
 * via the edits endpoint so the generated creative keeps the real venue/couple
 * rather than inventing a generic one, then normalize to exactly 1080×1350.
 *
 * Configure with env:
 *   AD_IMAGE_MODEL=gpt-image-2   (default; e.g. gpt-image-1, gpt-image-1.5)
 *   AD_IMAGE_SIZE=1024x1536      (portrait generation size before 4:5 crop)
 *   AD_IMAGE_QUALITY=high        (low|medium|high|auto)
 */

import { toFile } from 'openai';
import { getOpenAIImageClient } from '@/lib/ai-client';
import { AD_CTA, type AdCopyVariant, type VenueAdData } from '@/lib/ad-generator/spec';

const AD_IMAGE_MODEL = process.env.AD_IMAGE_MODEL || 'gpt-image-2';
const AD_IMAGE_SIZE = process.env.AD_IMAGE_SIZE || '1024x1536';
const AD_IMAGE_QUALITY = process.env.AD_IMAGE_QUALITY || 'high';
const MAX_REFS = 3;

/** Fetch a URL and re-encode to a modest PNG buffer for use as a reference. */
async function fetchAsPng(url: string, max = 1024): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const sharp = (await import('sharp')).default;
    return await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize(max, max, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

function buildImagePrompt(data: VenueAdData, variant: AdCopyVariant): string {
  const bullets = variant.imageBullets.slice(0, 5).map((b) => `• ${b}`).join('\n');
  const location = [data.city, data.state].filter(Boolean).join(', ');
  const priceLine = data.priceFrom ? `Packages from ${data.priceFrom}.` : '';

  return [
    'Design a scroll-stopping, magazine-style PORTRAIT (4:5, 1080x1350) Facebook/Instagram ad',
    'for a wedding venue. Editorial, high-end, elegant — like a luxury bridal magazine spread.',
    '',
    'USE THE ATTACHED REFERENCE PHOTOS as the real venue and real couple. Keep the actual',
    'venue, property, and people from those photos — do NOT invent a different building or faces.',
    'Feature a bride/groom or a beautiful shot of the venue/property. Never crop off faces, heads',
    'or bodies — keep people fully in frame and looking natural.',
    '',
    'LAYOUT: a clean two-part editorial composition. One larger hero photo plus one or two smaller',
    'supporting photos, with a calm cream/ivory text panel. Generous whitespace. Balanced, premium.',
    '',
    'TYPOGRAPHY: elegant thin serif headline (like Playfair Display) + clean sans-serif body',
    '(like Open Sans). Spelling must be perfect.',
    '',
    `HEADLINE (large serif): "${variant.imageHeadline}"`,
    `VENUE NAME (small elegant eyebrow/label): "${data.name}"${location ? ` — ${location}` : ''}`,
    'FEATURES (each preceded by a small GREEN checkmark icon, short and scannable):',
    bullets,
    priceLine,
    '',
    `CALL TO ACTION as a wide pill/arrow button near the bottom: "${AD_CTA.replace(/\.$/, '')}"`,
    '',
    'Style: soft natural light, timeless, romantic, no clutter, no stock-photo watermark,',
    'no lorem ipsum, no gibberish text, no extra logos. Keep every word above spelled exactly.',
  ]
    .filter((l) => l !== null && l !== undefined)
    .join('\n');
}

/**
 * Generate one AI ad creative as a 1080×1350 PNG buffer, or null on failure.
 * `refUrls` should be the venue's best (already vetted) photo URLs; the first
 * few are attached as references so the design keeps the real venue.
 */
export async function generateAdImage(
  data: VenueAdData,
  variant: AdCopyVariant,
  refUrls: string[],
): Promise<Buffer | null> {
  const client = getOpenAIImageClient();
  const prompt = buildImagePrompt(data, variant);

  const refBuffers = (
    await Promise.all(refUrls.slice(0, MAX_REFS).map((u) => fetchAsPng(u)))
  ).filter((b): b is Buffer => Boolean(b));

  let b64: string | undefined;
  try {
    if (refBuffers.length) {
      const files = await Promise.all(
        refBuffers.map((b, i) => toFile(b, `ref-${i}.png`, { type: 'image/png' })),
      );
      const rsp = await client.images.edit({
        model: AD_IMAGE_MODEL,
        image: files,
        prompt,
        size: AD_IMAGE_SIZE as '1024x1536',
        quality: AD_IMAGE_QUALITY as 'high',
      });
      b64 = rsp.data?.[0]?.b64_json;
    } else {
      const rsp = await client.images.generate({
        model: AD_IMAGE_MODEL,
        prompt,
        size: AD_IMAGE_SIZE as '1024x1536',
        quality: AD_IMAGE_QUALITY as 'high',
      });
      b64 = rsp.data?.[0]?.b64_json;
    }
  } catch (err) {
    console.error('[ad-generator/image-gen]', err instanceof Error ? err.message : err);
    return null;
  }

  if (!b64) return null;

  try {
    const raw = Buffer.from(b64, 'base64');
    const sharp = (await import('sharp')).default;
    return await sharp(raw)
      .resize(1080, 1350, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer();
  } catch (err) {
    console.error('[ad-generator/image-gen] normalize failed', err instanceof Error ? err.message : err);
    return null;
  }
}
