/**
 * Generate 3 Meta ad copy concepts for a venue via DeepSeek (JSON mode),
 * with validation, sanitization and a deterministic fallback so the endpoint
 * always returns usable copy even if the model call fails.
 */

import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import {
  AD_CTA, BATCH_TEMPLATES, buildCopyMessages,
  type AdCopyVariant, type TemplateKey, type VenueAdData,
} from '@/lib/ad-generator/spec';

const IMAGE_CTA = 'Download the pricing guide';

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

/** Trim a feature to a short, scannable phrase (~5 words, no trailing period). */
function shortFeature(f: string): string {
  return f.replace(/[.]+$/, '').split(/\s+/).slice(0, 6).join(' ');
}

function bulletCountFor(key: TemplateKey): number {
  return key === 'pricing' ? 6 : 5;
}

function fallbackVariant(data: VenueAdData, key: TemplateKey): AdCopyVariant {
  const city = data.city ? ` in ${data.city}` : '';
  const cap = data.capacityMax ?? data.capacityMin;
  const pool = [
    cap ? `Up to ${cap} guests` : 'Ceremony & reception',
    'Onsite bridal suite',
    data.city ? `Just outside ${data.city}` : 'Convenient location',
    'Tables & chairs included',
    'Vendor friendly',
    'Indoor & outdoor spaces',
    'On-site parking',
  ].filter(Boolean);
  const feats = (data.features.length ? data.features.map(shortFeature) : pool);
  const bullets = feats.slice(0, bulletCountFor(key));

  const primaryText = [
    `Hey engaged brides${city} 👰`,
    '',
    `Picture your wedding day at ${data.name} — a space made for your story.`,
    '',
    ...bullets.slice(0, 4).map((f) => `✅ ${f}`),
    '',
    data.priceFrom ? `Packages start at ${data.priceFrom}.` : 'Transparent, all-in pricing.',
    '',
    AD_CTA,
  ].join('\n');

  return {
    templateKey: key,
    imageHeadline: key === 'pricing'
      ? (data.priceFrom ? 'All-Inclusive Weddings' : 'Your Story Starts Here')
      : data.name,
    imageBullets: bullets,
    imageCta: IMAGE_CTA,
    kicker: '',
    primaryText,
    metaHeadline: data.priceFrom ? `Packages from ${data.priceFrom}` : 'Free pricing & availability guide',
  };
}

function sanitize(raw: unknown, data: VenueAdData, key: TemplateKey): AdCopyVariant {
  if (!raw || typeof raw !== 'object') return fallbackVariant(data, key);
  const r = raw as Record<string, unknown>;
  const bullets = arr(r.imageBullets, bulletCountFor(key), 32).map(shortFeature);
  const primaryText = s(r.primaryText, 1200);
  const headline = s(r.imageHeadline, 60);

  if (!primaryText || bullets.length === 0) {
    return fallbackVariant(data, key);
  }

  return {
    templateKey: key,
    // Editorial + showcase render the venue name as the headline regardless;
    // only the pricing template uses the model's promise headline.
    imageHeadline: key === 'pricing' ? (headline.replace(/[.]+$/, '') || 'All-Inclusive Weddings') : data.name,
    imageBullets: bullets,
    imageCta: s(r.imageCta, 40) || IMAGE_CTA,
    kicker: '',
    primaryText: ensureCta(primaryText),
    metaHeadline: s(r.metaHeadline, 60) || 'Free pricing & availability guide',
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
      temperature: 0.9,
      max_tokens: 3200,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { variants?: unknown[] };
    const variants = Array.isArray(parsed.variants) ? parsed.variants : [];

    // Map strictly by position so a batch alternates editorial/pricing as the
    // prompt was told; templateKey from the model is coerced to our slot's key.
    return BATCH_TEMPLATES.map((key, i) => sanitize(variants[i], data, key));
  } catch (err) {
    console.error('[ad-generator/copy] falling back:', err instanceof Error ? err.message : err);
    return BATCH_TEMPLATES.map((key) => fallbackVariant(data, key));
  }
}
