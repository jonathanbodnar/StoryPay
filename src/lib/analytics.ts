/**
 * Product-usage / funnel analytics.
 *
 * `trackEvent()` records a single behavioral event into
 * `public.analytics_events`, which powers the super-admin "Usage Analytics"
 * tab (top metrics, signup→activation funnel, top pages/clicks, trending,
 * live feed).
 *
 * Design philosophy (mirrors error-log.ts):
 *   - BEST-EFFORT: every write is wrapped in try/catch and NEVER throws, so a
 *     tracking failure can never break the underlying user request.
 *   - PII-LIGHT: emails are partial-masked; arbitrary props are length-capped.
 *   - FUNNEL-AWARE: `trackMilestone(..., { once: true })` records a named
 *     funnel step only the FIRST time a venue reaches it, so funnel counts are
 *     clean (one row per venue per milestone).
 */

import { supabaseAdmin } from '@/lib/supabase';

export type AnalyticsKind = 'auto' | 'milestone';

/** Named funnel milestones, in funnel order. Keep in sync with the admin panel. */
export const FUNNEL_MILESTONES = [
  'signup',
  'first_login',
  'branding_completed',
  'listing_published',
  'guide_created',
  'guide_published',
  'first_lead',
  'lead_replied',
  'ai_enabled',
  'upgrade',
] as const;
export type FunnelMilestone = (typeof FUNNEL_MILESTONES)[number];

export interface TrackEventInput {
  /** Event name, e.g. 'pageview', 'click', or a milestone like 'signup'. */
  event: string;
  /** Bucket. Defaults to 'auto'. */
  kind?: AnalyticsKind;
  /** Sub-account the actor belongs to (nullable for pre-login). */
  venueId?: string | null;
  /** Actor email, when known (partial-masked before storage). */
  userEmail?: string | null;
  /** Actor role: owner | admin | member | anon. */
  role?: string | null;
  /** Page path the event happened on. */
  path?: string | null;
  /** Human label (clicked element / milestone description). */
  label?: string | null;
  /** Client session id, to stitch a visit together. */
  sessionId?: string | null;
  /** Arbitrary structured context. */
  properties?: Record<string, unknown> | null;
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  if (!email.includes('@')) return email.slice(0, 64);
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}***@${d ?? ''}`;
}

function capProperties(props: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!props || typeof props !== 'object') return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (n++ >= 30) break;
    if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (v == null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else { try { out[k] = JSON.stringify(v).slice(0, 500); } catch { /* skip */ } }
  }
  return out;
}

/**
 * Record one analytics event. Best-effort: never throws. Returns the row id on
 * success, or null when skipped/failed.
 */
export async function trackEvent(input: TrackEventInput): Promise<string | null> {
  try {
    const kind: AnalyticsKind = input.kind ?? 'auto';
    const row = {
      event:      String(input.event).slice(0, 120),
      kind,
      venue_id:   input.venueId ?? null,
      user_email: maskEmail(input.userEmail),
      role:       input.role ?? null,
      path:       input.path ? String(input.path).slice(0, 400) : null,
      label:      input.label ? String(input.label).slice(0, 200) : null,
      session_id: input.sessionId ? String(input.sessionId).slice(0, 80) : null,
      properties: capProperties(input.properties),
      created_at: new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin
      .from('analytics_events')
      .insert(row)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data?.id as string) ?? null;
  } catch (e) {
    console.error('[analytics] trackEvent failed (non-fatal):', e);
    return null;
  }
}

/**
 * Record a funnel milestone. With `once: true` (the default), the event is only
 * recorded the FIRST time a venue reaches it — so funnel counts stay clean.
 * Best-effort: never throws.
 */
export async function trackMilestone(
  event: FunnelMilestone | string,
  input: Omit<TrackEventInput, 'event' | 'kind'> & { once?: boolean } = {},
): Promise<string | null> {
  try {
    const once = input.once ?? true;
    if (once && input.venueId) {
      const { data: existing } = await supabaseAdmin
        .from('analytics_events')
        .select('id')
        .eq('venue_id', input.venueId)
        .eq('event', event)
        .eq('kind', 'milestone')
        .limit(1)
        .maybeSingle();
      if (existing?.id) return null; // already counted for this venue
    }
    return await trackEvent({ ...input, event, kind: 'milestone' });
  } catch (e) {
    console.error('[analytics] trackMilestone failed (non-fatal):', e);
    return null;
  }
}
