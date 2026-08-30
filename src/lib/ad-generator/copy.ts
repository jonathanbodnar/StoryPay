/**
 * Generate 3 Meta ad copy concepts for a venue via DeepSeek (JSON mode),
 * with validation, sanitization and a deterministic fallback so the endpoint
 * always returns usable copy even if the model call fails.
 */

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import {
  AD_CTA, AD_CTA_SHORT, TEMPLATE_KEYS, buildCopyMessages,
  type AdCopyVariant, type TemplateKey, type VenueAdData,
} from '@/lib/ad-generator/spec';

function s(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function arr(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => s(x, maxLen)).filter(Boolean).slice(0, maxItems);
}

/** Force the primary text to end with the canonical CTA on its own line. */
function ensureCta(text: string): string {
  const t = text.replace(/\s+$/g, '');
  if (t.toLowerCase().includes(AD_CTA.toLowerCase())) return t;
  return `${t}\n\n${AD_CTA}`;
}

function fallbackVariant(data: VenueAdData, key: TemplateKey): AdCopyVariant {
  const city = data.city ? ` in ${data.city}` : '';
  const feats = (data.features.length ? data.features : ['Ceremony & reception', 'Bridal suite', 'On-site parking', 'In-house catering']).slice(0, 4);
  const bulletCount = key === 'photo' ? 3 : 4;
  const bullets = feats.slice(0, bulletCount);
  const priceLine = data.priceFrom ? `Packages start at ${data.priceFrom}.` : 'Transparent, all-in pricing.';
  const primaryText = [
    `Hey engaged brides${city} 👰`,
    '',
    `Picture your wedding day at ${data.name} — a space made for your story.`,
    '',
    ...feats.map((f) => `✅ ${f}`),
    '',
    priceLine,
    '',
    AD_CTA,
  ].join('\n');
  return {
    templateKey: key,
    imageHeadline: key === 'photo' ? 'See your story here' : `Your wedding day, beautifully yours`,
    imageBullets: bullets,
    imageCta: AD_CTA_SHORT,
    kicker: data.city ? `${data.city} Weddings` : 'Say I Do Here',
    primaryText,
    metaHeadline: data.priceFrom ? `Packages from ${data.priceFrom}` : 'Free pricing & availability guide',
    description: 'See pricing, spaces and open dates in one guide.',
  };
}

function sanitize(raw: unknown, data: VenueAdData, key: TemplateKey): AdCopyVariant {
  if (!raw || typeof raw !== 'object') return fallbackVariant(data, key);
  const r = raw as Record<string, unknown>;
  const bulletMax = key === 'photo' ? 3 : 4;
  const bullets = arr(r.imageBullets, bulletMax, 40);
  const primaryText = s(r.primaryText, 1200);
  const headline = s(r.imageHeadline, 80);

  if (!primaryText || !headline || bullets.length === 0) {
    return fallbackVariant(data, key);
  }

  return {
    templateKey: key,
    imageHeadline: headline.replace(/[.]+$/, ''),
    imageBullets: bullets,
    imageCta: s(r.imageCta, 40) || AD_CTA_SHORT,
    kicker: s(r.kicker, 40) || (data.city ? `${data.city} Weddings` : 'Say I Do Here'),
    primaryText: ensureCta(primaryText),
    metaHeadline: s(r.metaHeadline, 60) || 'Free pricing & availability guide',
    description: s(r.description, 120),
  };
}

export async function generateAdCopy(data: VenueAdData): Promise<AdCopyVariant[]> {
  const { system, user } = buildCopyMessages(data);

  try {
    const deepseek = getDeepSeekClient();
    const completion = await deepseek.chat.completions.create({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.85,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { variants?: unknown[] };
    const variants = Array.isArray(parsed.variants) ? parsed.variants : [];

    // Map returned variants to our fixed template order, matching by templateKey
    // when present, otherwise by index.
    return TEMPLATE_KEYS.map((key, i) => {
      const match =
        variants.find((v) => (v as Record<string, unknown>)?.templateKey === key) ?? variants[i];
      return sanitize(match, data, key);
    });
  } catch (err) {
    console.error('[ad-generator/copy] falling back:', err instanceof Error ? err.message : err);
    return TEMPLATE_KEYS.map((key) => fallbackVariant(data, key));
  }
}
