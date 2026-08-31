/**
 * Pick which venue photos are allowed into an ad, and in what order.
 *
 * Wedding ads only convert with the RIGHT imagery: real brides/grooms, wedding
 * moments, and beautiful property/venue shots. Close-up table settings, food,
 * construction, unfinished or cluttered rooms, and logos hurt. We can't tell
 * those apart from a URL, so we ask a vision model (OpenAI gpt-4o-mini) to rank
 * the candidates and drop the bad ones. Falls back to the original order if the
 * model/key is unavailable so generation never hard-fails.
 */

import { getOpenAIEmbeddingsClient } from '@/lib/ai-client';

const MAX_CANDIDATES = 14;

const PROMPT = [
  'You are choosing photos for a high-end wedding-venue Facebook ad aimed at engaged brides.',
  'Look at each numbered image and decide if it belongs in the ad.',
  '',
  'KEEP (good): real brides and/or grooms, couples, wedding-day moments, ceremonies,',
  'and beautiful PROPERTY shots — venue building exterior, grounds/landscape, and',
  'wide, finished, elegant interior spaces (ceremony or reception rooms that look polished).',
  '',
  'REJECT (bad): close-up table settings / place settings / tablescapes, plates, cutlery,',
  'glassware or food close-ups; construction, unfinished, messy, cluttered, or empty-looking',
  'rooms; parking lots; logos/graphics/text slides; screenshots; dark, blurry or low-quality photos.',
  '',
  'Return ONLY JSON: {"good":[indices]} — the 0-based indices of the KEEP images,',
  'ordered best-first (most scroll-stopping / most emotional / clearest hero shot first).',
  'Be selective: it is better to return fewer strong photos than to include weak ones.',
].join('\n');

interface VisionContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail: 'low' | 'high' | 'auto' };
}

export async function selectAdPhotos(photos: string[]): Promise<string[]> {
  const candidates = photos.slice(0, MAX_CANDIDATES);
  if (candidates.length <= 2) return photos;

  try {
    const client = getOpenAIEmbeddingsClient();

    const content: VisionContentPart[] = [{ type: 'text', text: PROMPT }];
    candidates.forEach((url, i) => {
      content.push({ type: 'text', text: `Image ${i}:` });
      content.push({ type: 'image_url', image_url: { url, detail: 'low' } });
    });

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}') as { good?: unknown };
    const good = Array.isArray(parsed.good) ? parsed.good : [];
    const picked = good
      .map((i) => (typeof i === 'number' ? candidates[i] : undefined))
      .filter((u): u is string => Boolean(u));

    if (picked.length >= 2) {
      // Keep only the vetted photos (best-first). If the model was very strict we
      // still have enough because slots cycle through this list.
      return Array.from(new Set(picked));
    }

    // Model rejected almost everything — trust it a little but keep the originals
    // as a safety net so we never render a blank ad.
    return Array.from(new Set([...picked, ...photos]));
  } catch (err) {
    console.error('[ad photo-select] falling back to original order:', err instanceof Error ? err.message : err);
    return photos;
  }
}
