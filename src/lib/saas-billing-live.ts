/**
 * Live SaaS subscription figures for the super admin dashboard.
 *
 * Stripe keeps each venue's subscription status current through webhooks
 * (lib/stripe/webhooks.ts), so the database is right about who is paying. It
 * doesn't hold what each venue is actually billed (a private client's
 * plan-only deal, add-ons), so amounts are read from Stripe here.
 *
 * LunarPay still bills the few venues that haven't moved to Stripe, and it
 * never tells the app about its charges. Its subscriptions are read live too,
 * and a charge LunarPay took that the app hasn't recorded is added to
 * platform_billing_events (what "SaaS cash" sums). LunarPay only shows the
 * latest charge per subscription, so this catches each one as the dashboard
 * loads; charges before this existed were never recorded.
 *
 * Read at most once a minute, so the dashboard can reload freely.
 */
import { supabaseAdmin } from '@/lib/supabase';
import { getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { listSubscriptions } from '@/lib/lunarpay';
import { getPlatformLunarPaySecretKey } from '@/lib/platform-directory-billing';

export interface SaasBillingVenue {
  id: string;
  billing_provider: string | null;
  stripe_subscription_id: string | null;
  directory_subscription_external_id: string | null;
  directory_plan_id: string | null;
}

export interface LiveSaasSub {
  provider: 'stripe' | 'lunarpay';
  /** The processor's own status (Stripe: active, trialing, past_due…; LunarPay: active, cancelled…). */
  status: string;
  /** What the venue is billed per month. */
  amountCents: number;
  /** LunarPay: its latest charge. */
  lastPaymentOn: string | null;
  subscriptionId: string;
}

/** The venue's subscription id at Stripe or LunarPay, if it has one. */
export function saasSubscriptionRef(v: SaasBillingVenue): { provider: 'stripe' | 'lunarpay'; id: string } | null {
  if (v.stripe_subscription_id) return { provider: 'stripe', id: v.stripe_subscription_id };
  const ext = v.directory_subscription_external_id ? String(v.directory_subscription_external_id) : '';
  if (!ext) return null;
  return ext.startsWith('sub_') ? { provider: 'stripe', id: ext } : { provider: 'lunarpay', id: ext };
}

let cache: { at: number; key: string; subs: Map<string, LiveSaasSub>; warnings: string[] } | null = null;
const CACHE_MS = 60_000;

/** venueId → its live subscription, for venues with one on file. */
export async function loadLiveSaasSubscriptions(
  venues: SaasBillingVenue[],
): Promise<{ subs: Map<string, LiveSaasSub>; warnings: string[] }> {
  const refs = venues
    .map((v) => ({ venueId: v.id, ref: saasSubscriptionRef(v) }))
    .filter((r): r is { venueId: string; ref: { provider: 'stripe' | 'lunarpay'; id: string } } => r.ref !== null);
  const key = refs.map((r) => `${r.venueId}:${r.ref.id}`).sort().join('|');
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) {
    return { subs: cache.subs, warnings: cache.warnings };
  }

  const subs = new Map<string, LiveSaasSub>();
  const warnings: string[] = [];

  const stripeRefs = refs.filter((r) => r.ref.provider === 'stripe');
  if (stripeRefs.length) {
    if (!isStripeConfigured()) {
      warnings.push('Stripe isn’t configured, so Stripe amounts are the plan prices.');
    } else {
      const stripe = getStripe();
      const results = await Promise.allSettled(stripeRefs.map((r) => stripe.subscriptions.retrieve(r.ref.id)));
      let failed = 0;
      results.forEach((res, i) => {
        if (res.status !== 'fulfilled') { failed++; return; }
        const sub = res.value;
        const amountCents = sub.items.data.reduce((sum, it) => {
          const unit = (it.price.unit_amount ?? 0) * (it.quantity ?? 1);
          const r = it.price.recurring;
          const perMonth = r?.interval === 'year' ? unit / 12 : r?.interval === 'week' ? (unit * 52) / 12 : unit;
          return sum + perMonth / (r?.interval_count || 1);
        }, 0);
        subs.set(stripeRefs[i].venueId, {
          provider: 'stripe',
          status: sub.status,
          amountCents: Math.round(amountCents),
          lastPaymentOn: null,
          subscriptionId: sub.id,
        });
      });
      if (failed) warnings.push(`Couldn’t read ${failed} Stripe subscription${failed === 1 ? '' : 's'}; using plan prices for them.`);
    }
  }

  const lunarRefs = refs.filter((r) => r.ref.provider === 'lunarpay');
  if (lunarRefs.length) {
    const sk = getPlatformLunarPaySecretKey();
    if (!sk) {
      warnings.push('LunarPay isn’t configured, so LunarPay venues use their stored status and plan price.');
    } else {
      try {
        const res = await listSubscriptions(sk);
        const list = (Array.isArray(res) ? res : (res as { data?: unknown[] }).data ?? []) as Record<string, unknown>[];
        const byId = new Map(list.map((s) => [String(s.id), s]));
        for (const r of lunarRefs) {
          const s = byId.get(r.ref.id);
          if (!s) continue;
          const freq = String(s.frequency ?? 'monthly').toLowerCase();
          const amount = Number(s.amount) || 0;
          subs.set(r.venueId, {
            provider: 'lunarpay',
            status: String(s.status ?? '').toLowerCase(),
            amountCents: Math.round(freq.startsWith('year') || freq === 'annually' ? amount / 12 : amount),
            lastPaymentOn: typeof s.lastPaymentOn === 'string' ? s.lastPaymentOn : null,
            subscriptionId: r.ref.id,
          });
        }
      } catch (e) {
        warnings.push(`Couldn’t reach LunarPay (${e instanceof Error ? e.message : 'request failed'}); LunarPay venues use their stored status and plan price.`);
      }
    }
  }

  cache = { at: Date.now(), key, subs, warnings };
  return { subs, warnings };
}

/**
 * Record LunarPay subscription charges the app never heard about. Skips one
 * already recorded (by this, or a charge the app logged itself within a day of
 * it). Returns how many it added.
 */
export async function recordUnseenLunarPayCharges(
  venues: SaasBillingVenue[],
  subs: Map<string, LiveSaasSub>,
): Promise<number> {
  let added = 0;
  for (const v of venues) {
    const s = subs.get(v.id);
    if (!s || s.provider !== 'lunarpay' || !s.lastPaymentOn || s.amountCents <= 0) continue;
    const paidAt = new Date(s.lastPaymentOn);
    if (Number.isNaN(paidAt.getTime())) continue;
    const externalId = `lp_sub_${s.subscriptionId}_${s.lastPaymentOn.slice(0, 10)}`;

    const { data: same } = await supabaseAdmin
      .from('platform_billing_events')
      .select('id')
      .eq('external_event_id', externalId)
      .limit(1);
    if (same?.length) continue;
    const day = 24 * 60 * 60 * 1000;
    const { data: nearby } = await supabaseAdmin
      .from('platform_billing_events')
      .select('id')
      .eq('venue_id', v.id)
      .eq('event_type', 'charge_success')
      .gte('occurred_at', new Date(paidAt.getTime() - day).toISOString())
      .lte('occurred_at', new Date(paidAt.getTime() + day).toISOString())
      .limit(1);
    if (nearby?.length) continue;

    const { error } = await supabaseAdmin.from('platform_billing_events').insert({
      venue_id: v.id,
      directory_plan_id: v.directory_plan_id,
      amount_cents: s.amountCents,
      currency: 'usd',
      external_event_id: externalId,
      event_type: 'charge_success',
      occurred_at: paidAt.toISOString(),
      provider: 'lunarpay',
      metadata: { source: 'lunarpay_subscription_sync', subscription_id: s.subscriptionId },
    });
    if (error) console.warn('[saas-billing-live] could not record a LunarPay charge:', v.id, error.message);
    else added++;
  }
  return added;
}
