/**
 * Generate 3 Meta ad copy concepts for a venue via DeepSeek (JSON mode),
 * with validation, sanitization and a deterministic fallback so the endpoint
 * always returns usable copy even if the model call fails.
 */

import { getAnthropicClient, getDeepSeekClient, getOpenAIChatClient, DEEPSEEK_MODEL } from '@/lib/ai-client';
import {
  AD_CTA, BATCH_TEMPLATES, buildCopyMessages,
  type AdCopyVariant, type TemplateKey, type VenueAdData,
} from '@/lib/ad-generator/spec';

type CopyProvider = 'anthropic' | 'openai' | 'deepseek';

/**
 * Which provider writes the ad copy. Defaults to Claude (Anthropic) for top-tier
 * copywriting, and automatically falls back to OpenAI (then DeepSeek) if the
 * matching key isn't configured. Image generation is unaffected — it stays on
 * OpenAI. Override with env:
 *   AD_COPY_PROVIDER=anthropic|openai|deepseek
 *   AD_COPY_MODEL=<id>   → override the Anthropic (primary) model id
 */
function resolveProvider(): CopyProvider {
  const explicit = (process.env.AD_COPY_PROVIDER || '').toLowerCase();
  if (explicit === 'anthropic' || explicit === 'openai' || explicit === 'deepseek') return explicit;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'deepseek';
}

function modelFor(provider: CopyProvider): string {
  if (provider === 'anthropic') return process.env.AD_COPY_MODEL || 'claude-opus-4-8';
  if (provider === 'deepseek') return DEEPSEEK_MODEL;
  return process.env.AD_COPY_MODEL_OPENAI || 'gpt-5.6-sol';
}

/** The GPT-5 family uses `max_completion_tokens` and only supports the default
 * temperature, so we tailor the request params to the model to avoid 400s. */
function isGpt5Family(model: string): boolean {
  return /^gpt-5/i.test(model) || /^o[0-9]/i.test(model);
}

/** Parse a model's JSON reply, tolerating stray prose or code fences around it. */
function safeParseVariants(content: string): unknown[] {
  const tryParse = (s: string): unknown[] | null => {
    try {
      const p = JSON.parse(s) as { variants?: unknown[] };
      return Array.isArray(p.variants) ? p.variants : null;
    } catch { return null; }
  };
  let out = tryParse(content);
  if (!out) {
    const first = content.indexOf('{');
    const last = content.lastIndexOf('}');
    if (first !== -1 && last > first) out = tryParse(content.slice(first, last + 1));
  }
  return out ?? [];
}

/**
 * Claude copy call — force structured output via tool use. (Reasoning models like
 * claude-opus-4-8 reject assistant-prefill, so tool use is the reliable way to
 * guarantee valid JSON.) Returns the tool input serialized as a JSON string.
 */
const AD_COPY_TOOL = {
  name: 'emit_ad_copy',
  description: 'Return the finished Meta ad copy concepts for the venue.',
  input_schema: {
    type: 'object' as const,
    properties: {
      variants: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            imageHeadline: { type: 'string' },
            imageBullets: { type: 'array', items: { type: 'string' } },
            imageCta: { type: 'string' },
            primaryText: { type: 'string' },
            metaHeadline: { type: 'string' },
          },
          required: ['imageHeadline', 'imageBullets', 'primaryText', 'metaHeadline'],
        },
      },
    },
    required: ['variants'],
  },
};

async function callAnthropic(system: string, user: string, model: string): Promise<string> {
  const client = getAnthropicClient();
  const msg = await client.messages.create({
    model,
    max_tokens: 4000,
    temperature: 1,
    system,
    messages: [{ role: 'user', content: user }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: [AD_COPY_TOOL as any],
    tool_choice: { type: 'tool', name: 'emit_ad_copy' },
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  const input = block && block.type === 'tool_use' ? block.input : {};
  return JSON.stringify(input ?? {});
}

/** OpenAI / DeepSeek copy call (JSON mode). */
async function callOpenAILike(system: string, user: string, model: string, provider: CopyProvider): Promise<string> {
  const client = provider === 'deepseek' ? getDeepSeekClient() : getOpenAIChatClient();
  const base = {
    model,
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ],
    response_format: { type: 'json_object' as const },
  };
  const params = isGpt5Family(model)
    ? { ...base, max_completion_tokens: 4000 }
    : { ...base, temperature: 0.9, max_tokens: 3200 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completion = await client.chat.completions.create(params as any);
  return completion.choices[0]?.message?.content ?? '{}';
}

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

/** Deterministic promise headlines if the model call fails, varied per slot. */
const PROMISE_POOL = [
  'Where Your Forever Begins',
  'Say I Do In Style',
  'Your Dream Day Awaits',
  'Picture Your Perfect Day',
  'The Wedding You Imagined',
  'Your Story Starts Here',
];

function fallbackVariant(data: VenueAdData, key: TemplateKey, idx = 0): AdCopyVariant {
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
    imageHeadline: key === 'pricing' && data.priceFrom
      ? 'All-Inclusive Weddings'
      : PROMISE_POOL[idx % PROMISE_POOL.length],
    imageBullets: bullets,
    imageCta: IMAGE_CTA,
    kicker: '',
    primaryText,
    metaHeadline: data.priceFrom ? `Packages from ${data.priceFrom}` : 'Free pricing & availability guide',
  };
}

function sanitize(raw: unknown, data: VenueAdData, key: TemplateKey, idx = 0): AdCopyVariant {
  if (!raw || typeof raw !== 'object') return fallbackVariant(data, key, idx);
  const r = raw as Record<string, unknown>;
  const bullets = arr(r.imageBullets, bulletCountFor(key), 32).map(shortFeature);
  const primaryText = s(r.primaryText, 1200);
  const headline = s(r.imageHeadline, 60).replace(/[."']+$/, '').replace(/^["']+/, '');

  if (!primaryText || bullets.length === 0) {
    return fallbackVariant(data, key, idx);
  }

  return {
    templateKey: key,
    // Every template shows a high-converting PROMISE headline; the venue name is
    // rendered separately as an eyebrow.
    imageHeadline: headline || PROMISE_POOL[idx % PROMISE_POOL.length],
    imageBullets: bullets,
    imageCta: s(r.imageCta, 40) || IMAGE_CTA,
    kicker: '',
    primaryText: ensureCta(primaryText),
    metaHeadline: s(r.metaHeadline, 60) || 'Free pricing & availability guide',
  };
}

/** One model call for a specific ordered set of templates → mapped variants. */
async function generateOnce(
  provider: CopyProvider,
  data: VenueAdData,
  templates: TemplateKey[],
  startIdx: number,
  angle?: string,
): Promise<AdCopyVariant[]> {
  const { system, user } = buildCopyMessages(data, templates, angle);
  const content =
    provider === 'anthropic'
      ? await callAnthropic(system, user, modelFor(provider))
      : await callOpenAILike(system, user, modelFor(provider), provider);

  const raw = safeParseVariants(content);
  if (raw.length === 0) throw new Error('model returned no variants');
  // Map strictly by position so the batch alternates editorial/pricing as told.
  return templates.map((key, i) => sanitize(raw[i], data, key, startIdx + i));
}

export async function generateAdCopy(data: VenueAdData): Promise<AdCopyVariant[]> {
  const primary = resolveProvider();

  // Claude Opus is slow per call, so split the batch into two smaller concept
  // sets and generate them IN PARALLEL — roughly halves copy latency while
  // keeping Opus quality. Each half gets a distinct angle so the 6 stay varied.
  if (primary === 'anthropic') {
    try {
      const mid = Math.ceil(BATCH_TEMPLATES.length / 2);
      const [a, b] = await Promise.all([
        generateOnce('anthropic', data, BATCH_TEMPLATES.slice(0, mid), 0,
          'Lead with emotion and the dream-day story.'),
        generateOnce('anthropic', data, BATCH_TEMPLATES.slice(mid), mid,
          'Lead with value, inclusions and an effortless, all-in experience.'),
      ]);
      return [...a, ...b];
    } catch (err) {
      console.error('[ad-generator/copy] anthropic failed:', err instanceof Error ? err.message : err);
      // fall through to the OpenAI/DeepSeek single-call fallback below
    }
  }

  // Fallback chain (also the path for non-Claude primaries): single call for all.
  const chain: CopyProvider[] =
    primary === 'anthropic'
      ? (['openai', 'deepseek'] as CopyProvider[]).filter(
          (p) =>
            (p === 'openai' && process.env.OPENAI_API_KEY) ||
            (p === 'deepseek' && process.env.DEEPSEEK_API_KEY),
        )
      : [primary];

  for (const provider of chain) {
    try {
      return await generateOnce(provider, data, BATCH_TEMPLATES, 0);
    } catch (err) {
      console.error(`[ad-generator/copy] ${provider} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.error('[ad-generator/copy] all providers failed — using static fallback');
  return BATCH_TEMPLATES.map((key, i) => fallbackVariant(data, key, i));
}
