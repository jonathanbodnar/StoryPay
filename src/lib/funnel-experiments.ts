import { supabaseAdmin } from '@/lib/supabase';

/**
 * Admin data-access for the landing-page hero A/B testing system.
 *
 * The variants live in the shared Supabase project (funnel_variants /
 * funnel_pages). storyvenue.com renders the hero + records impressions/clicks;
 * this module powers the StoryPay super-admin "Funnel A/B" tab that manages the
 * variations and reads the live stats.
 */

export type ElementKey = 'headline' | 'subheadline' | 'cta';
export const FUNNEL_ELEMENTS: ElementKey[] = ['headline', 'subheadline', 'cta'];

export interface VariantRow {
  id: string;
  page_key: string;
  element: ElementKey;
  content: string;
  enabled: boolean;
  pinned: boolean;
  impressions: number;
  clicks: number;
  position: number;
}

export interface VariantStat extends VariantRow {
  ctr: number;
  probBest: number | null;
}

export interface PageSettings {
  page_key: string;
  auto_pause: boolean;
  min_impressions: number;
}

export interface ExperimentView {
  page: PageSettings;
  elements: Record<ElementKey, VariantStat[]>;
}

/** Headline convention: text after the first "|" renders in gold. */
export function parseHeadline(content: string): { line1: string; line2: string } {
  const idx = content.indexOf('|');
  if (idx === -1) return { line1: content.trim(), line2: '' };
  return { line1: content.slice(0, idx).trim(), line2: content.slice(idx + 1).trim() };
}

/* ---------------- Bandit math (Thompson Sampling on CTR) ---------------- */

function gaussian(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = gaussian();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

/** Probability each enabled variant is the best (Monte Carlo). */
export function probabilityBest(variants: VariantRow[], draws = 4000): Record<string, number> {
  const enabled = variants.filter((v) => v.enabled);
  const result: Record<string, number> = {};
  for (const v of enabled) result[v.id] = 0;
  if (enabled.length <= 1) {
    if (enabled.length === 1) result[enabled[0].id] = 1;
    return result;
  }
  for (let i = 0; i < draws; i++) {
    let bestId = enabled[0].id;
    let bestTheta = -1;
    for (const v of enabled) {
      const clicks = Math.max(0, v.clicks);
      const impr = Math.max(clicks, v.impressions);
      const theta = sampleBeta(clicks + 1, impr - clicks + 1);
      if (theta > bestTheta) {
        bestTheta = theta;
        bestId = v.id;
      }
    }
    result[bestId] += 1;
  }
  for (const id of Object.keys(result)) result[id] /= draws;
  return result;
}

/* ---------------- Stats ---------------- */

export async function getExperimentView(pageKey: string): Promise<ExperimentView | null> {
  const [{ data: variants, error }, { data: pageRows }] = await Promise.all([
    supabaseAdmin
      .from('funnel_variants')
      .select('id, page_key, element, content, enabled, pinned, impressions, clicks, position')
      .eq('page_key', pageKey)
      .order('element', { ascending: true })
      .order('position', { ascending: true }),
    supabaseAdmin
      .from('funnel_pages')
      .select('page_key, auto_pause, min_impressions')
      .eq('page_key', pageKey),
  ]);

  if (error) return null;

  const page: PageSettings = (pageRows?.[0] as PageSettings) ?? {
    page_key: pageKey,
    auto_pause: false,
    min_impressions: 200,
  };

  const elements = {} as Record<ElementKey, VariantStat[]>;
  for (const el of FUNNEL_ELEMENTS) {
    const rows = ((variants ?? []) as VariantRow[]).filter((r) => r.element === el);
    const probs = probabilityBest(rows);
    elements[el] = rows.map((r) => ({
      ...r,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : 0,
      probBest: r.enabled ? probs[r.id] ?? null : null,
    }));
  }

  return { page, elements };
}

/* ---------------- Mutations ---------------- */

export async function upsertVariant(input: {
  id?: string;
  page_key: string;
  element: ElementKey;
  content: string;
}): Promise<boolean> {
  if (input.id) {
    const { error } = await supabaseAdmin
      .from('funnel_variants')
      .update({ content: input.content, updated_at: new Date().toISOString() })
      .eq('id', input.id);
    return !error;
  }

  const { data: existing } = await supabaseAdmin
    .from('funnel_variants')
    .select('id, position')
    .eq('page_key', input.page_key)
    .eq('element', input.element);
  if ((existing?.length ?? 0) >= 5) return false;
  const nextPos =
    Math.max(0, ...((existing ?? []).map((r) => (r as { position: number }).position))) + 1;

  const { error } = await supabaseAdmin.from('funnel_variants').insert({
    page_key: input.page_key,
    element: input.element,
    content: input.content,
    position: existing && existing.length === 0 ? 0 : nextPos,
  });
  return !error;
}

export async function setVariantFlags(
  id: string,
  flags: { enabled?: boolean; pinned?: boolean },
): Promise<boolean> {
  if (flags.pinned === true) {
    const { data: row } = await supabaseAdmin
      .from('funnel_variants')
      .select('page_key, element')
      .eq('id', id)
      .single();
    if (row) {
      await supabaseAdmin
        .from('funnel_variants')
        .update({ pinned: false })
        .eq('page_key', (row as VariantRow).page_key)
        .eq('element', (row as VariantRow).element);
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (flags.enabled !== undefined) patch.enabled = flags.enabled;
  if (flags.pinned !== undefined) patch.pinned = flags.pinned;

  const { error } = await supabaseAdmin.from('funnel_variants').update(patch).eq('id', id);
  return !error;
}

export async function deleteVariant(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from('funnel_variants').delete().eq('id', id);
  return !error;
}

export async function resetVariantStats(id: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('funnel_variants')
    .update({ impressions: 0, clicks: 0, updated_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

export async function setPageSettings(
  pageKey: string,
  settings: { auto_pause?: boolean; min_impressions?: number },
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('funnel_pages')
    .upsert(
      { page_key: pageKey, ...settings, updated_at: new Date().toISOString() },
      { onConflict: 'page_key' },
    );
  return !error;
}
