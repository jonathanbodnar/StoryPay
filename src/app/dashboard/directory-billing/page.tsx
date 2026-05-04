'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  BadgeCheck,
  BotMessageSquare,
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  Lock,
  Megaphone,
  Receipt,
  ShieldCheck,
  Sparkles,
  X,
  AlertTriangle,
} from 'lucide-react';

const BRAND = '#1b1b1b';

/**
 * Curated plan feature list shown as check/X rows inside each plan's
 * accordion body. `key` maps to a feature_flags JSONB key on directory_plans.
 */
const PLAN_FEATURES: { key: string; label: string; outcome: string }[] = [
  { key: 'dashboard_home',           label: 'Dashboard',                    outcome: 'Central hub for your venue activity and metrics' },
  { key: 'contacts',                 label: 'Contacts & CRM',               outcome: 'Manage every lead and client in one place' },
  { key: 'conversations',            label: 'Conversations inbox',          outcome: 'Unified inbox for all client messages and inquiries' },
  { key: 'leads',                    label: 'Lead management',              outcome: 'Track, qualify, and convert every inquiry into a booking' },
  { key: 'calendar',                 label: 'Calendar & scheduling',        outcome: 'Block dates, track bookings, and sync availability' },
  { key: 'payments',                 label: 'Payments & proposals',         outcome: 'Send proposals, collect deposits, and track payments' },
  { key: 'marketing',                label: 'Email marketing',              outcome: 'Campaigns, automations, and audience management' },
  { key: 'listing',                  label: 'Venue directory listing',      outcome: 'Appear in the wedding directory so couples can find you' },
  { key: 'nav_listing_pricing_guide',label: 'Pricing & availability guide', outcome: 'Share your pricing with couples in a polished branded guide' },
  { key: 'ai_assistant',             label: 'Ask AI assistant',             outcome: 'Draft emails, respond to leads, and generate content instantly' },
  { key: 'reports',                  label: 'Analytics & reports',          outcome: 'Revenue insights, booking trends, and performance data' },
];

/** Returns true if a plan's feature_flags includes the given feature key. */
function planIncludesFeature(featureFlags: Record<string, unknown>, key: string): boolean {
  if (Boolean(featureFlags[key])) return true;
  // 'nav_listing_pricing_guide' is implicitly included when the entire 'listing' group is on.
  if (key === 'nav_listing_pricing_guide' && Boolean(featureFlags.listing)) return true;
  return false;
}

type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_monthly_cents: number | null;
  is_default: boolean;
  sort_order: number;
  feature_flags: Record<string, unknown>;
  trial_period_value?: number;
  trial_period_unit?: 'none' | 'days' | 'weeks' | 'months' | 'years' | 'forever' | string;
  highlight_label?: string | null;
};

type TrialState = {
  status: 'none' | 'active' | 'forever' | 'expired';
  started_at: string | null;
  ends_at: string | null;
  is_forever: boolean;
  days_remaining: number | null;
  plan_id: string | null;
};

type PaymentMethod = {
  id: string;
  last4: string | null;
  brand: string | null;
  name_holder: string | null;
  is_default: boolean;
  exp_month: string | null;
  exp_year: string | null;
} | null;

type Subscription = {
  id: string;
  status: string;
  amount_cents: number;
  frequency: string;
  next_payment_on: string | null;
  started_on: string | null;
} | null;

type HistoryEntry = {
  id: string;
  event_type: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  plan_id: string | null;
  plan_name: string | null;
  external_event_id: string | null;
  status: 'paid' | 'refunded' | 'failed' | 'pending';
};

type Addons = {
  verified: boolean;
  sponsored: boolean;
  concierge: boolean;
  verifiedFromPlan: boolean;
  sponsoredFromPlan: boolean;
  conciergeFromPlan: boolean;
  conciergeAvailable: boolean;
  verifiedUser: boolean;
  sponsoredUser: boolean;
  conciergeUser: boolean;
};

type ChargeBreakdown = {
  plan_cents: number;
  verified_cents: number;
  sponsored_cents: number;
  concierge_cents: number;
  total_cents: number;
};

type BillingSummary = {
  venue: { id: string; name: string; email: string | null };
  current_plan: Plan | null;
  subscription: Subscription;
  subscription_status: string;
  payment_method: PaymentMethod;
  plans: Plan[];
  history: HistoryEntry[];
  billing_configured: boolean;
  addons: Addons;
  charge: ChargeBreakdown;
  plan_addon_inclusion: Record<string, { verified: boolean; sponsored: boolean }>;
  addon_prices: { verified_cents: number; sponsored_cents: number; concierge_cents: number };
  trial: TrialState;
  is_legacy_plan?: boolean;
};

function formatTrialDuration(p: Pick<Plan, 'trial_period_value' | 'trial_period_unit'>): string {
  const unit = (p.trial_period_unit as string | undefined) || 'none';
  if (unit === 'none') return '';
  if (unit === 'forever') return 'Free forever';
  const v = typeof p.trial_period_value === 'number' ? p.trial_period_value : 0;
  if (v <= 0) return '';
  return `${v}-${unit.replace(/s$/, '')} free trial`;
}

function planHasTrial(p: Pick<Plan, 'trial_period_value' | 'trial_period_unit'>): boolean {
  const unit = (p.trial_period_unit as string | undefined) || 'none';
  if (unit === 'none') return false;
  if (unit === 'forever') return true;
  return (typeof p.trial_period_value === 'number' ? p.trial_period_value : 0) > 0;
}

function formatCents(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function humaniseEventType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Translate raw API errors into something a venue owner can understand. */
function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes('lp_sk_') ||
    lower.includes('invalid or missing secret api key') ||
    lower.includes('not configured') ||
    lower.includes('lunarpay api error 401') ||
    lower.includes('lunarpay api error 403')
  ) {
    return 'Billing isn\'t fully configured on the server yet. Please contact support — we\'ll get this resolved quickly.';
  }
  if (lower.includes('lunarpay api error 5')) {
    return 'LunarPay is temporarily unavailable. Please try again in a moment.';
  }
  return raw;
}

export default function DirectoryBillingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPlanId, setConfirmPlanId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/venue-billing');
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(friendlyError(d.error || 'Could not load billing'));
        return;
      }
      setSummary((await res.json()) as BillingSummary);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (!sessionId) return;
    const paymentUpdate = searchParams.get('payment_update') === '1';
    const addonFlow = searchParams.get('addons') === '1';
    const startPaidFlow = searchParams.get('start_paid') === '1';
    let cancelled = false;
    (async () => {
      setBusy(
        startPaidFlow
          ? 'verify_start_paid'
          : addonFlow
            ? 'verify_addons'
            : paymentUpdate
              ? 'verify_payment_update'
              : 'verify_checkout',
      );
      setError('');
      try {
        const endpoint = startPaidFlow
          ? '/api/venue-billing/start-paid/verify'
          : addonFlow
            ? '/api/venue-billing/addons/verify'
            : paymentUpdate
              ? '/api/venue-billing/update-payment'
              : '/api/directory-platform/verify';
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(d.error || 'Verification failed');
        if (!cancelled) {
          setInfo(
            startPaidFlow
              ? 'Card on file — your subscription will start when your trial ends.'
              : addonFlow
                ? 'Add-on subscription activated — your monthly bill is now updated.'
                : paymentUpdate
                  ? 'Payment method updated.'
                  : 'Subscription activated.',
          );
          router.replace('/dashboard/directory-billing');
          await load();
        }
      } catch (e) {
        if (!cancelled) setError(friendlyError(e instanceof Error ? e.message : 'Verification failed'));
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, router, load]);

  async function changePlan(planId: string) {
    setConfirmPlanId(null);
    setBusy(`change:${planId}`);
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/venue-billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      });
      const d = (await res.json().catch(() => ({}))) as
        | { kind: 'switched'; plan_id: string }
        | { kind: 'checkout_required'; url: string; plan_id: string }
        | { error?: string };
      if (!res.ok) throw new Error((d as { error?: string }).error || 'Plan change failed');
      if ((d as { kind?: string }).kind === 'checkout_required') {
        window.location.href = (d as { url: string }).url;
        return;
      }
      setInfo('Plan updated.');
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Plan change failed'));
    } finally {
      setBusy(null);
    }
  }

  async function resumeCheckout() {
    setBusy('resume');
    setError('');
    try {
      const res = await fetch('/api/venue-billing/resume-checkout', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not resume checkout');
      if (d.url) window.location.href = d.url;
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Could not resume checkout'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelPending() {
    setBusy('cancel_pending');
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/venue-billing/cancel-pending', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not cancel pending upgrade');
      setInfo('Pending upgrade cancelled.');
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Could not cancel pending upgrade'));
    } finally {
      setBusy(null);
    }
  }

  async function updatePaymentMethod() {
    setBusy('update_pm');
    setError('');
    try {
      const res = await fetch('/api/venue-billing/update-payment', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not start payment update');
      if (d.url) window.location.href = d.url;
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Could not start payment update'));
    } finally {
      setBusy(null);
    }
  }

  async function startPaid() {
    setBusy('start_paid');
    setError('');
    try {
      const res = await fetch('/api/venue-billing/start-paid', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not start paid checkout');
      if (d.url) window.location.href = d.url;
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Could not start paid checkout'));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAddon(kind: 'verified' | 'sponsored' | 'concierge') {
    if (!summary) return;
    const userKey = kind === 'verified' ? 'verifiedUser' : kind === 'sponsored' ? 'sponsoredUser' : 'conciergeUser';
    const next = !summary.addons[userKey];
    setBusy(`addon:${kind}`);
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/venue-billing/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [kind]: next }),
      });
      const d = (await res.json().catch(() => ({}))) as
        | { kind: 'switched'; total_cents: number }
        | { kind: 'checkout_required'; url: string }
        | { error?: string };
      if (!res.ok) throw new Error((d as { error?: string }).error || 'Could not update add-on');
      if ((d as { kind?: string }).kind === 'checkout_required') {
        window.location.href = (d as { url: string }).url;
        return;
      }
      const labels: Record<string, string> = {
        verified:  'Verified Listing',
        sponsored: 'Sponsored Listing',
        concierge: 'Venue Concierge',
      };
      setInfo(
        next
          ? `${labels[kind]} added — your monthly bill is being updated.`
          : `${labels[kind]} removed — your monthly bill will be reduced on the next cycle.`,
      );
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Add-on update failed'));
    } finally {
      setBusy(null);
    }
  }

  async function cancelSubscription() {
    setConfirmCancel(false);
    setBusy('cancel');
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/venue-billing/cancel', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || 'Cancel failed');
      setInfo('Subscription canceled. You can resubscribe anytime.');
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Cancel failed'));
    } finally {
      setBusy(null);
    }
  }

  const plans = useMemo(() => {
    if (!summary) return [] as Plan[];
    return [...summary.plans].sort(
      (a, b) => (a.price_monthly_cents ?? 0) - (b.price_monthly_cents ?? 0),
    );
  }, [summary]);

  if (loading && !summary) {
    return (
      <div className="flex justify-center py-24 text-gray-400">
        <Loader2 className="animate-spin" size={28} />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="max-w-xl">
        <h1 className="font-heading text-2xl text-gray-900">Plans &amp; billing</h1>
        <p className="mt-2 text-sm text-red-600">{error || 'Could not load billing.'}</p>
      </div>
    );
  }

  // ── Legacy plan gate ──────────────────────────────────────────────────────
  if (summary.is_legacy_plan) {
    return (
      <div className="max-w-2xl">
        <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
          <Lock size={22} className="text-gray-700" /> Plans &amp; billing
        </h1>
        <p className="mt-1 text-sm text-gray-500">Your account billing overview.</p>

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white overflow-hidden">
          <div className="bg-gradient-to-r from-gray-900 to-gray-700 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                <Lock size={20} className="text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
                  {summary.current_plan?.name ?? 'Legacy Plan'}
                </p>
                <p className="text-lg font-bold text-white">Billing managed directly</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              Your account is set up as a legacy client. All features and add-ons are included
              as part of your arrangement — no subscription through the platform is required.
              Billing is handled directly with your account manager.
            </p>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">What&apos;s included</p>
              {[
                'All platform features',
                'Verified Listing badge',
                'Sponsored Listing placement',
                'Venue Concierge (AI + personal follow-up)',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm text-gray-700">
                  <Check size={15} className="text-emerald-500 shrink-0" />
                  {item}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400">
              Questions about your account? Contact your account manager directly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentPlan = summary.current_plan;
  const currentCents = currentPlan?.price_monthly_cents ?? 0;
  const status = summary.subscription_status;
  const isActive = status === 'active' || status === 'trialing';
  const isPastDue = status === 'past_due';
  const isPending = status === 'pending';
  const confirmTarget = confirmPlanId ? plans.find((p) => p.id === confirmPlanId) : null;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
          <CreditCard size={22} className="text-gray-700" /> Plans &amp; billing
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your StoryVenue plan, update your card on file, and review past invoices.
          Billing is handled securely by LunarPay.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      ) : null}
      {info ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {info}
        </div>
      ) : null}
      {busy === 'verify_checkout' || busy === 'verify_payment_update' || busy === 'verify_addons' || busy === 'verify_start_paid' ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Confirming with LunarPay…
        </div>
      ) : null}
      {!summary.billing_configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Billing isn&apos;t fully set up on our end yet. Please reach out to support and we&apos;ll get
          you sorted right away.
        </div>
      ) : null}

      {/* Trial banner — active or expired trial gets a prominent CTA */}
      {summary.trial.status === 'active' || summary.trial.status === 'forever' ? (
        <TrialActiveBanner
          trial={summary.trial}
          chargeTotalCents={summary.charge.total_cents}
          hasPaymentMethod={Boolean(summary.payment_method)}
          busy={busy}
          onAddCard={() => void startPaid()}
        />
      ) : summary.trial.status === 'expired' && (currentPlan?.price_monthly_cents ?? 0) > 0 ? (
        <TrialExpiredBanner
          chargeTotalCents={summary.charge.total_cents}
          busy={busy}
          onAddCard={() => void startPaid()}
        />
      ) : null}

      {/* Pending recovery banner — when a plan is selected but checkout never completed */}
      {isPending && currentPlan && (currentPlan.price_monthly_cents ?? 0) > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="flex-shrink-0 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900">Complete your upgrade to {currentPlan.name}</h3>
              <p className="mt-1 text-sm text-amber-800">
                You started upgrading to <strong>{currentPlan.name}</strong> ({formatCents(currentPlan.price_monthly_cents)}/mo)
                but didn&apos;t finish entering your card. Resume secure checkout to activate the plan, or cancel
                this upgrade and stay on your current plan.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void resumeCheckout()}
                  disabled={busy === 'resume'}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: BRAND }}
                >
                  {busy === 'resume' ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Lock size={12} />
                  )}
                  Resume secure checkout
                </button>
                <button
                  type="button"
                  onClick={() => void cancelPending()}
                  disabled={busy === 'cancel_pending'}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  {busy === 'cancel_pending' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  Cancel upgrade
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Plans accordion ──────────────────────────────────────────── */}
      <section>
        <div className="mb-3">
          <h2 className="font-heading text-lg text-gray-900">Your plan</h2>
          <p className="text-sm text-gray-500">
            Click any plan to expand details, manage add-ons, and upgrade or switch anytime.
          </p>
        </div>

        {plans.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            No directory plans configured yet. An admin needs to set up plans in the super admin panel.
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
            {plans.map((plan) => {
              const isCurrent = currentPlan?.id === plan.id && (isActive || isPastDue);
              const isPendingThis = currentPlan?.id === plan.id && isPending;
              const cents = plan.price_monthly_cents ?? 0;
              const inclusion = summary.plan_addon_inclusion[plan.id] || { verified: false, sponsored: false };
              const planFF = (plan.feature_flags ?? {}) as Record<string, unknown>;
              const conciergeAvailable = Boolean(planFF.addon_concierge_available);
              const conciergeIncluded  = Boolean(planFF.addon_concierge_included);
              const verifiedAdds  = !inclusion.verified  && summary.addons.verifiedUser  ? summary.addon_prices.verified_cents  : 0;
              const sponsoredAdds = !inclusion.sponsored && summary.addons.sponsoredUser ? summary.addon_prices.sponsored_cents : 0;
              const conciergeAdds = (conciergeAvailable || conciergeIncluded) && !conciergeIncluded && summary.addons.conciergeUser ? (summary.addon_prices.concierge_cents ?? 49900) : 0;
              const previewTotal = cents + verifiedAdds + sponsoredAdds + conciergeAdds;
              const previewDelta = previewTotal - summary.charge.total_cents;
              const isExpanded = expandedPlanId === plan.id;

              return (
                <div key={plan.id} className={isCurrent ? 'bg-emerald-50/60' : ''}>
                  {/* ── Row header — always visible ── */}
                  <button
                    type="button"
                    onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                          {cents > 0 ? 'Paid' : 'Free'}{plan.is_default ? ' · default' : ''}
                        </div>
                        <div className="font-semibold text-sm leading-tight text-gray-900">
                          {plan.name}
                        </div>
                      </div>
                      {isCurrent && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <Check size={10} /> Active plan
                        </span>
                      )}
                      {planHasTrial(plan) && (
                        <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-50 border border-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                          <Sparkles size={9} /> {formatTrialDuration(plan)}
                        </span>
                      )}
                      {plan.highlight_label && (
                        <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                          ★ {plan.highlight_label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="font-bold text-sm text-gray-900">
                          {cents > 0 ? formatCents(cents) : 'Free'}
                          {cents > 0 && <span className="text-xs font-normal ml-0.5 text-gray-500">/mo</span>}
                        </div>
                        {summary.subscription?.next_payment_on && isCurrent ? (
                          <div className="text-[10px] text-gray-400">Next: {formatDate(summary.subscription.next_payment_on)}</div>
                        ) : null}
                      </div>
                      <ChevronDown
                        size={15}
                        className={`transition-transform duration-200 shrink-0 text-gray-400 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </button>

                  {/* ── Expanded body ── */}
                  {isExpanded && (
                    <div className="px-5 pb-6 space-y-5 border-t border-gray-100">
                      <div className="pt-4 space-y-3">
                        {plan.description ? (
                          <p className="text-sm text-gray-600">{plan.description}</p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          {planHasTrial(plan) ? (
                            <div className="sm:hidden inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                              <Sparkles size={11} /> {formatTrialDuration(plan)}
                            </div>
                          ) : null}
                          {isCurrent ? (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              isActive
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : isPastDue
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-gray-200 bg-gray-50 text-gray-600'
                            }`}>
                              <ShieldCheck size={10} /> {status.replace(/_/g, ' ') || 'none'}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* ── Features ── */}
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3 text-gray-500">
                          What&apos;s included
                        </div>
                        <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                          {PLAN_FEATURES.map((f) => {
                            const on = planIncludesFeature(plan.feature_flags, f.key);
                            return (
                              <div key={f.key} className="flex items-start gap-2.5">
                                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                                  on ? 'bg-emerald-100 text-emerald-600' : 'bg-red-50 text-red-400'
                                }`}>
                                  {on
                                    ? <Check size={10} strokeWidth={3} />
                                    : <X size={10} strokeWidth={3} />}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold leading-tight text-gray-900">
                                    {f.label}
                                  </div>
                                  <div className="text-[11px] leading-snug text-gray-500">
                                    {f.outcome}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── Add-ons ── */}
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3 text-gray-500">
                          Add-ons
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <AddonRow
                            icon={<BadgeCheck size={18} />}
                            label="Verified Listing"
                            description="Verified badge on your listing, in search, and in inquiries — builds trust with couples browsing."
                            priceCents={summary.addon_prices.verified_cents}
                            isOn={summary.addons.verified}
                            isFromPlan={inclusion.verified}
                            isUserOn={summary.addons.verifiedUser}
                            busy={busy === 'addon:verified'}
                            onChange={() => void toggleAddon('verified')}
                            tone="emerald"
                          />
                          <AddonRow
                            icon={<Megaphone size={18} />}
                            label="Sponsored Listing"
                            description="Top-of-results placement and 'Sponsored' label, with priority above non-sponsored venues."
                            priceCents={summary.addon_prices.sponsored_cents}
                            isOn={summary.addons.sponsored}
                            isFromPlan={inclusion.sponsored}
                            isUserOn={summary.addons.sponsoredUser}
                            busy={busy === 'addon:sponsored'}
                            onChange={() => void toggleAddon('sponsored')}
                            tone="violet"
                          />
                        </div>

                        {/* Venue Concierge — only shown on plans where it's available or included */}
                        {(conciergeAvailable || conciergeIncluded) && (
                          <div className="mt-3">
                            <AddonRow
                              icon={<BotMessageSquare size={18} />}
                              label="Venue Concierge"
                              description="A personal concierge + AI forever-follow-up so no lead is ever forgotten. Books more tours for you automatically."
                              priceCents={summary.addon_prices.concierge_cents ?? 49900}
                              isOn={summary.addons.concierge}
                              isFromPlan={conciergeIncluded}
                              isUserOn={summary.addons.conciergeUser}
                              busy={busy === 'addon:concierge'}
                              onChange={() => void toggleAddon('concierge')}
                              tone="indigo"
                            />
                          </div>
                        )}
                      </div>

                      {/* ── Monthly total breakdown ── */}
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3 text-gray-500">
                          Monthly total
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between text-gray-700">
                            <span>{plan.name}</span>
                            <span className="font-mono">{cents > 0 ? formatCents(cents) : 'Free'}</span>
                          </div>
                          <div className="flex justify-between text-gray-700">
                            <span className="flex items-center gap-1.5">
                              Verified Listing
                              {inclusion.verified ? (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Included</span>
                              ) : null}
                            </span>
                            <span className="font-mono">
                              {isCurrent
                                ? (summary.charge.verified_cents > 0 ? formatCents(summary.charge.verified_cents) : summary.addons.verified ? 'Included' : '—')
                                : (verifiedAdds > 0 ? `+${formatCents(verifiedAdds)}` : inclusion.verified && summary.addons.verifiedUser ? 'Included' : '—')}
                            </span>
                          </div>
                          <div className="flex justify-between text-gray-700">
                            <span className="flex items-center gap-1.5">
                              Sponsored Listing
                              {inclusion.sponsored ? (
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Included</span>
                              ) : null}
                            </span>
                            <span className="font-mono">
                              {isCurrent
                                ? (summary.charge.sponsored_cents > 0 ? formatCents(summary.charge.sponsored_cents) : summary.addons.sponsored ? 'Included' : '—')
                                : (sponsoredAdds > 0 ? `+${formatCents(sponsoredAdds)}` : inclusion.sponsored && summary.addons.sponsoredUser ? 'Included' : '—')}
                            </span>
                          </div>
                          {(conciergeAvailable || conciergeIncluded) && (
                            <div className="flex justify-between text-gray-700">
                              <span className="flex items-center gap-1.5">
                                Venue Concierge
                                {conciergeIncluded ? (
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Included</span>
                                ) : null}
                              </span>
                              <span className="font-mono">
                                {isCurrent
                                  ? ((summary.charge.concierge_cents ?? 0) > 0 ? formatCents(summary.charge.concierge_cents) : summary.addons.concierge ? 'Included' : '—')
                                  : (conciergeAdds > 0 ? `+${formatCents(conciergeAdds)}` : conciergeIncluded && summary.addons.conciergeUser ? 'Included' : '—')}
                              </span>
                            </div>
                          )}
                          <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-gray-900">
                            <span>Total billed monthly</span>
                            <span className="font-mono">
                              {isCurrent
                                ? (summary.charge.total_cents > 0 ? formatCents(summary.charge.total_cents) : 'Free')
                                : (previewTotal > 0 ? formatCents(previewTotal) : 'Free')}
                              {!isCurrent && previewDelta !== 0 ? (
                                <span className={`ml-1.5 text-xs font-semibold ${previewDelta > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                  ({previewDelta > 0 ? '+' : ''}{formatCents(previewDelta)})
                                </span>
                              ) : null}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                          Pricing subject to change at any time. Subscribers receive at least 30 days&apos; advance notice before any price increase.
                        </p>
                      </div>

                      {/* ── Actions ── */}
                      {isCurrent ? (
                        (isActive || isPastDue) ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy === 'update_pm'}
                              onClick={() => void updatePaymentMethod()}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {busy === 'update_pm' ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                              Update payment method
                            </button>
                            <button
                              type="button"
                              disabled={busy === 'cancel'}
                              onClick={() => setConfirmCancel(true)}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
                            >
                              {busy === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                              Cancel subscription
                            </button>
                          </div>
                        ) : null
                      ) : isPendingThis ? (
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900">
                          <AlertTriangle size={12} /> Complete checkout above
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === `change:${plan.id}` || isPending}
                          onClick={() => setConfirmPlanId(plan.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: BRAND }}
                        >
                          {busy === `change:${plan.id}` ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <ArrowUpRight size={12} />
                          )}
                          {cents === 0
                            ? 'Switch to free'
                            : planHasTrial(plan) && summary.trial.status === 'none' && !summary.subscription
                              ? 'Start free trial'
                              : previewDelta > 0
                                ? 'Upgrade'
                                : 'Switch plan'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Payment method ──────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-heading text-lg text-gray-900">Payment method</h2>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {summary.payment_method ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-14 rounded-md bg-gray-900 text-white text-[10px] font-bold flex items-center justify-center uppercase tracking-wide">
                {summary.payment_method.brand || 'Card'}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">
                  •••• {summary.payment_method.last4 || '––––'}
                </div>
                <div className="text-[11px] text-gray-500">
                  {summary.payment_method.name_holder || summary.venue.name}
                  {summary.payment_method.exp_month && summary.payment_method.exp_year
                    ? ` · expires ${summary.payment_method.exp_month}/${String(summary.payment_method.exp_year).slice(-2)}`
                    : ''}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No card on file.{' '}
              {currentCents > 0 ? 'Resume checkout to add one.' : 'Switch to a paid plan to add a payment method.'}
            </p>
          )}
          {currentCents > 0 && summary.payment_method ? (
            <button
              type="button"
              disabled={busy === 'update_pm'}
              onClick={() => void updatePaymentMethod()}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {busy === 'update_pm' ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
              Update payment method
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-heading text-lg text-gray-900 flex items-center gap-2">
            <Receipt size={16} /> Billing history
          </h2>
          <span className="text-xs text-gray-500">
            {summary.history.length} {summary.history.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        {summary.history.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-500">
            No billing activity yet. Past invoices and refunds will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3">Plan</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                  <th className="px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.history.map((row) => (
                  <tr key={row.id}>
                    <td className="px-6 py-3 text-gray-700">{formatDate(row.occurred_at)}</td>
                    <td className="px-6 py-3 text-gray-700">{humaniseEventType(row.event_type)}</td>
                    <td className="px-6 py-3 text-gray-500">{row.plan_name || '—'}</td>
                    <td
                      className={`px-6 py-3 text-right font-mono ${
                        row.status === 'refunded' || row.amount_cents < 0
                          ? 'text-red-700'
                          : row.status === 'failed'
                            ? 'text-amber-700'
                            : 'text-gray-900'
                      }`}
                    >
                      {row.status === 'refunded' && row.amount_cents > 0
                        ? `-${formatCents(row.amount_cents)}`
                        : formatCents(row.amount_cents)}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize ${
                          row.status === 'paid'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : row.status === 'refunded'
                              ? 'border-gray-200 bg-gray-50 text-gray-600'
                              : row.status === 'failed'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmTarget ? (
        <UpgradePlanModal
          plan={confirmTarget}
          currentPlan={currentPlan}
          currentTotalCents={summary.charge.total_cents}
          targetInclusion={
            summary.plan_addon_inclusion[confirmTarget.id] || { verified: false, sponsored: false }
          }
          addons={summary.addons}
          addonPrices={summary.addon_prices}
          paymentMethod={summary.payment_method}
          trial={summary.trial}
          subscriptionExists={Boolean(summary.subscription)}
          busy={busy === `change:${confirmTarget.id}`}
          addonBusy={busy?.startsWith('addon:') ? (busy.split(':')[1] as 'verified' | 'sponsored' | 'concierge') : null}
          onToggleAddon={(kind) => void toggleAddon(kind)}
          onCancel={() => setConfirmPlanId(null)}
          onConfirm={() => void changePlan(confirmTarget.id)}
        />
      ) : null}

      {confirmCancel ? (
        <ConfirmDialog
          title="Cancel your StoryVenue subscription?"
          body={
            <>
              Your paid plan will end and your venue will drop back to the free tier. Billing stops
              immediately with LunarPay — you won&apos;t be charged again. You can resubscribe later.
            </>
          }
          confirmLabel="Cancel subscription"
          confirmTone="danger"
          confirmBusy={busy === 'cancel'}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => void cancelSubscription()}
        />
      ) : null}
    </div>
  );
}

/**
 * Banner shown when the venue is in an active trial OR on a perpetual
 * "free forever" trial. Counts down the days and prompts the venue to add
 * a card so billing can pick up automatically when the trial ends.
 */
function TrialActiveBanner({
  trial,
  chargeTotalCents,
  hasPaymentMethod,
  busy,
  onAddCard,
}: {
  trial: TrialState;
  chargeTotalCents: number;
  hasPaymentMethod: boolean;
  busy: string | null;
  onAddCard: () => void;
}) {
  const isForever = trial.status === 'forever';
  const daysLeft = trial.days_remaining ?? 0;
  const endsLabel = trial.ends_at
    ? new Date(trial.ends_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-md">
            <Sparkles size={18} />
          </div>
          <div>
            <h3 className="font-heading text-base text-gray-900">
              {isForever ? 'Free forever' : `Free trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
            </h3>
            <p className="mt-0.5 text-sm text-gray-700">
              {isForever ? (
                <>You&apos;re on a perpetual free trial. No charges, no expiration.</>
              ) : (
                <>
                  Your trial ends {endsLabel ? <strong>{endsLabel}</strong> : 'soon'}. After that you&apos;ll be charged{' '}
                  <strong>{formatCents(chargeTotalCents)}/mo</strong>
                  {hasPaymentMethod ? ' on the card on file.' : '. Add a card now to keep using StoryVenue.'}
                </>
              )}
            </p>
          </div>
        </div>
        {!isForever && !hasPaymentMethod ? (
          <button
            type="button"
            onClick={onAddCard}
            disabled={busy === 'start_paid'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {busy === 'start_paid' ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
            Add card now
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Banner shown after a trial ended without a card on file. The venue is
 * gated to free until they add a payment method (or they downgrade to free).
 */
function TrialExpiredBanner({
  chargeTotalCents,
  busy,
  onAddCard,
}: {
  chargeTotalCents: number;
  busy: string | null;
  onAddCard: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h3 className="font-heading text-base text-amber-900">Your free trial has ended</h3>
            <p className="mt-0.5 text-sm text-amber-800">
              Add a card to keep your current plan and add-ons. You&apos;ll be charged{' '}
              <strong>{formatCents(chargeTotalCents)}/mo</strong>, starting today.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onAddCard}
          disabled={busy === 'start_paid'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {busy === 'start_paid' ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />}
          Add card &amp; keep plan
        </button>
      </div>
    </div>
  );
}

function PlanAddonToggle({
  label,
  priceCents,
  included,
  userOn,
  busy,
  isCurrent,
  tone,
  onToggle,
}: {
  label: string;
  priceCents: number;
  included: boolean;
  userOn: boolean;
  busy: boolean;
  isCurrent: boolean;
  tone: 'emerald' | 'violet';
  onToggle: () => void;
}) {
  if (included) {
    return (
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className={isCurrent ? 'text-gray-200' : 'text-gray-700'}>{label}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          isCurrent ? 'bg-emerald-400/20 text-emerald-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
        }`}>
          <Check size={10} /> Included
        </span>
      </div>
    );
  }

  const checkedColor = tone === 'emerald' ? 'bg-emerald-600 border-emerald-600' : 'bg-violet-600 border-violet-600';
  const uncheckedColor = isCurrent ? 'bg-white/10 border-white/30' : 'bg-white border-gray-300';

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={userOn}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`-mx-1.5 flex w-[calc(100%+12px)] items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors ${
        isCurrent ? 'hover:bg-white/10' : 'hover:bg-gray-50'
      } disabled:opacity-60`}
    >
      <span className="flex items-center gap-2">
        <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-2 transition ${
          userOn ? checkedColor : uncheckedColor
        }`}>
          {busy ? (
            <Loader2
              size={9}
              className={`animate-spin ${isCurrent ? 'text-gray-200' : 'text-gray-500'}`}
            />
          ) : userOn ? (
            <Check size={9} className="text-white" strokeWidth={3} />
          ) : null}
        </span>
        <span className={isCurrent ? 'text-gray-200' : 'text-gray-700'}>{label}</span>
      </span>
      <span className={`text-[11px] ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>
        {formatCents(priceCents)}/mo
      </span>
    </button>
  );
}

/**
 * Compact add-on toggle for the upgrade modal — same live-toggle behavior
 * as the plan-card variant, sized to fit inside the plan-summary card.
 */
function ModalAddonToggle({
  label,
  priceCents,
  included,
  userOn,
  busy,
  tone,
  onToggle,
}: {
  label: string;
  priceCents: number;
  included: boolean;
  userOn: boolean;
  busy: boolean;
  tone: 'emerald' | 'violet' | 'indigo';
  onToggle: () => void;
}) {
  if (included) {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5 text-xs text-gray-700">
        <span className="flex items-center gap-2">
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-2 bg-emerald-600 border-emerald-600">
            <Check size={9} className="text-white" strokeWidth={3} />
          </span>
          {label}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          Included
        </span>
      </div>
    );
  }
  const checkedColor =
    tone === 'emerald' ? 'bg-emerald-600 border-emerald-600' :
    tone === 'indigo'  ? 'bg-indigo-600 border-indigo-600'   :
    'bg-violet-600 border-violet-600';
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={userOn}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="-mx-2 flex w-[calc(100%+16px)] items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-60"
    >
      <span className="flex items-center gap-2">
        <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border-2 transition ${
          userOn ? checkedColor : 'bg-white border-gray-300'
        }`}>
          {busy ? (
            <Loader2 size={9} className="animate-spin text-gray-500" />
          ) : userOn ? (
            <Check size={9} className="text-white" strokeWidth={3} />
          ) : null}
        </span>
        {label}
      </span>
      <span className="font-mono text-[11px] text-gray-600">
        {userOn ? `+${formatCents(priceCents)}` : formatCents(priceCents)}
      </span>
    </button>
  );
}

/**
 * Add-ons management card for the venue's CURRENT plan. Shows the verified +
 * sponsored toggles, the live total of plan + active add-ons, and a clear
 * "what gets billed" breakdown.
 *
 * Add-ons that are bundled with the current plan render as "Included" + locked.
 */
function AddonsCard({
  addons,
  charge,
  verifiedPriceCents,
  sponsoredPriceCents,
  currentPlan,
  busy,
  onToggle,
}: {
  addons: Addons;
  charge: ChargeBreakdown;
  verifiedPriceCents: number;
  sponsoredPriceCents: number;
  currentPlan: Plan | null;
  busy: string | null;
  onToggle: (kind: 'verified' | 'sponsored') => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg text-gray-900 flex items-center gap-2">
            <Sparkles size={16} className="text-violet-500" /> Verified &amp; Sponsored add-ons
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Stack these on top of any plan. Toggling on or off updates your monthly charge instantly —
            no need to wait until your next billing cycle.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <AddonRow
          icon={<BadgeCheck size={18} />}
          label="Verified Listing"
          description="Verified badge on your listing, in search, and in inquiries — builds trust with brides browsing."
          priceCents={verifiedPriceCents}
          isOn={addons.verified}
          isFromPlan={addons.verifiedFromPlan}
          isUserOn={addons.verifiedUser}
          busy={busy === 'addon:verified'}
          onChange={() => onToggle('verified')}
          tone="emerald"
        />
        <AddonRow
          icon={<Megaphone size={18} />}
          label="Sponsored Listing"
          description="Top-of-results placement and 'Sponsored' label, with priority above non-sponsored venues."
          priceCents={sponsoredPriceCents}
          isOn={addons.sponsored}
          isFromPlan={addons.sponsoredFromPlan}
          isUserOn={addons.sponsoredUser}
          busy={busy === 'addon:sponsored'}
          onChange={() => onToggle('sponsored')}
          tone="violet"
        />
      </div>

      {/* Live total breakdown */}
      <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Monthly total
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex items-center justify-between text-gray-700">
            <span>{currentPlan?.name || 'Free plan'}</span>
            <span className="font-mono">{charge.plan_cents > 0 ? formatCents(charge.plan_cents) : 'Free'}</span>
          </div>
          <div className="flex items-center justify-between text-gray-700">
            <span>
              Verified Listing
              {addons.verifiedFromPlan ? (
                <span className="ml-1.5 text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Included</span>
              ) : null}
            </span>
            <span className="font-mono">
              {charge.verified_cents > 0 ? formatCents(charge.verified_cents) : addons.verified ? 'Included' : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-gray-700">
            <span>
              Sponsored Listing
              {addons.sponsoredFromPlan ? (
                <span className="ml-1.5 text-[10px] font-semibold text-emerald-700 uppercase tracking-wide">Included</span>
              ) : null}
            </span>
            <span className="font-mono">
              {charge.sponsored_cents > 0 ? formatCents(charge.sponsored_cents) : addons.sponsored ? 'Included' : '—'}
            </span>
          </div>
          <div className="border-t border-gray-200 mt-2 pt-2 flex items-center justify-between text-gray-900 font-semibold">
            <span>Total billed monthly</span>
            <span className="font-mono">
              {charge.total_cents > 0 ? formatCents(charge.total_cents) : 'Free'}
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-gray-500">
          Charges happen automatically on the same monthly cycle as your plan. Pricing is subject to
          change at any time. Current subscribers will receive at least 30 days&apos; advance notice
          before any price increase takes effect.
        </p>
      </div>
    </section>
  );
}

function AddonRow({
  icon,
  label,
  description,
  priceCents,
  isOn,
  isFromPlan,
  isUserOn,
  busy,
  onChange,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  priceCents: number;
  isOn: boolean;
  isFromPlan: boolean;
  isUserOn: boolean;
  busy: boolean;
  onChange: () => void;
  tone: 'emerald' | 'violet' | 'indigo';
}) {
  const ringClass =
    tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/40' :
    tone === 'indigo'  ? 'border-indigo-200 bg-indigo-50/40'   :
    'border-violet-200 bg-violet-50/40';

  const iconBg =
    tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' :
    tone === 'indigo'  ? 'bg-indigo-100 text-indigo-700'   :
    'bg-violet-100 text-violet-700';

  // ── Plan-included: no checkbox, just show a clean "Included" pill ────────
  if (isFromPlan) {
    return (
      <div className={`relative flex flex-col gap-2 rounded-xl border p-4 ${ringClass}`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 flex flex-wrap items-center gap-2">
              {label}
              <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Included
              </span>
            </div>
            <p className="mt-0.5 text-xs text-gray-600 leading-relaxed">{description}</p>
            <div className="mt-1.5 text-[11px] text-emerald-700 font-medium">
              {isUserOn ? 'Active on your listing.' : 'Active automatically while you\'re on this plan.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Optional add-on: interactive checkbox ────────────────────────────────
  const checkboxBg = isOn
    ? tone === 'emerald' ? 'bg-emerald-600 border-emerald-600' :
      tone === 'indigo'  ? 'bg-indigo-600 border-indigo-600'   :
      'bg-violet-600 border-violet-600'
    : 'bg-white border-gray-300';

  return (
    <label
      htmlFor={`addon-${label}`}
      className={`relative flex flex-col gap-2 rounded-xl border p-4 cursor-pointer transition-colors ${
        isOn ? ringClass : 'border-gray-200 bg-white hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
            {icon}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">{label}</div>
            <p className="mt-0.5 text-xs text-gray-600 leading-relaxed">{description}</p>
            <div className="mt-1.5 text-[11px] text-gray-500">
              {formatCents(priceCents)} / month
            </div>
          </div>
        </div>
        <button
          type="button"
          id={`addon-${label}`}
          aria-checked={isOn}
          role="checkbox"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            onChange();
          }}
          className={`flex-shrink-0 mt-1 inline-flex h-5 w-5 items-center justify-center rounded border-2 transition ${checkboxBg} disabled:opacity-50`}
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin text-gray-700" />
          ) : isOn ? (
            <Check size={12} className="text-white" strokeWidth={3} />
          ) : null}
        </button>
      </div>
    </label>
  );
}

/**
 * Polished plan-change modal. Shows the target plan summary, what's changing,
 * and a clear "Continue to secure checkout" CTA when a redirect is needed.
 * If the user already has a card on file, the change happens in-place via the
 * subscription PATCH endpoint — no redirect.
 */
function UpgradePlanModal({
  plan,
  currentPlan,
  currentTotalCents,
  targetInclusion,
  addons,
  addonPrices,
  paymentMethod,
  trial,
  subscriptionExists,
  busy,
  addonBusy,
  onToggleAddon,
  onCancel,
  onConfirm,
}: {
  plan: Plan;
  currentPlan: Plan | null;
  currentTotalCents: number;
  targetInclusion: { verified: boolean; sponsored: boolean };
  addons: Addons;
  addonPrices: { verified_cents: number; sponsored_cents: number; concierge_cents: number };
  paymentMethod: PaymentMethod;
  trial: TrialState;
  subscriptionExists: boolean;
  busy: boolean;
  addonBusy: 'verified' | 'sponsored' | 'concierge' | null;
  onToggleAddon: (kind: 'verified' | 'sponsored' | 'concierge') => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const planCents = plan.price_monthly_cents ?? 0;
  const planFF = (plan.feature_flags ?? {}) as Record<string, unknown>;
  const modalConciergeAvailable = Boolean(planFF.addon_concierge_available);
  const modalConciergeIncluded  = Boolean(planFF.addon_concierge_included);
  // Total they'll be charged on the new plan, retaining their current addon toggles.
  const verifiedAdds   = !targetInclusion.verified  && addons.verifiedUser  ? addonPrices.verified_cents  : 0;
  const sponsoredAdds  = !targetInclusion.sponsored && addons.sponsoredUser ? addonPrices.sponsored_cents : 0;
  const conciergeAdds  = (modalConciergeAvailable || modalConciergeIncluded) && !modalConciergeIncluded && addons.conciergeUser ? (addonPrices.concierge_cents ?? 49900) : 0;
  const newTotalCents  = planCents + verifiedAdds + sponsoredAdds + conciergeAdds;

  const isFree = newTotalCents === 0;
  const isDowngradeToFree = isFree && currentTotalCents > 0;
  const hasActivePaid = Boolean(paymentMethod) && currentTotalCents > 0 && subscriptionExists;
  // Trial path: target plan offers a trial, no existing subscription, and the
  // venue hasn't already consumed a trial (status === 'none' or 'active').
  const eligibleForTrial =
    !subscriptionExists &&
    planHasTrial(plan) &&
    (trial.status === 'none' || trial.status === 'active' || trial.status === 'forever');
  const willStartTrial = !isFree && eligibleForTrial;
  const willCharge = !isFree && !hasActivePaid && !willStartTrial; // first paid signup → checkout redirect
  const willPatch = !isFree && hasActivePaid;   // already paying → patch the LunarPay subscription
  const nextBillEstimate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }, []);
  const trialDuration = formatTrialDuration(plan);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: BRAND }}>
                {isDowngradeToFree ? (
                  <ArrowUpRight size={18} className="text-white rotate-180" />
                ) : (
                  <ArrowUpRight size={18} className="text-white" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-heading text-lg text-gray-900">
                  {isDowngradeToFree
                    ? `Switch to ${plan.name}`
                    : willPatch
                      ? `Upgrade to ${plan.name}`
                      : `Subscribe to ${plan.name}`}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  {currentPlan ? `Currently on ${currentPlan.name}` : 'No plan currently assigned'}
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Plan summary card with full breakdown */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {plan.name}
                  </div>
                  {plan.description ? (
                    <p className="mt-0.5 text-xs text-gray-600">{plan.description}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-900">
                    {planCents > 0 ? formatCents(planCents) : 'Free'}
                  </div>
                  {planCents > 0 ? <div className="text-[11px] text-gray-500">per month</div> : null}
                </div>
              </div>

              {/* Add-on toggles — live on top of the plan switch. Toggling
                  immediately updates the venue's add-on state, so by the
                  time the user clicks Confirm the LunarPay subscription
                  amount already reflects what they want. */}
              <div className="border-t border-gray-200 pt-2 space-y-0.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Add-ons
                </div>
                <ModalAddonToggle
                  label="Verified Listing"
                  priceCents={addonPrices.verified_cents}
                  included={targetInclusion.verified}
                  userOn={addons.verifiedUser}
                  busy={addonBusy === 'verified'}
                  tone="emerald"
                  onToggle={() => onToggleAddon('verified')}
                />
                <ModalAddonToggle
                  label="Sponsored Listing"
                  priceCents={addonPrices.sponsored_cents}
                  included={targetInclusion.sponsored}
                  userOn={addons.sponsoredUser}
                  busy={addonBusy === 'sponsored'}
                  tone="violet"
                  onToggle={() => onToggleAddon('sponsored')}
                />
                {(modalConciergeAvailable || modalConciergeIncluded) && (
                  <ModalAddonToggle
                    label="Venue Concierge"
                    priceCents={addonPrices.concierge_cents ?? 49900}
                    included={modalConciergeIncluded}
                    userOn={addons.conciergeUser}
                    busy={addonBusy === 'concierge'}
                    tone="indigo"
                    onToggle={() => onToggleAddon('concierge')}
                  />
                )}
              </div>
              <div className="border-t border-gray-200 pt-2 flex items-center justify-between text-sm font-semibold text-gray-900">
                <span>Total per month</span>
                <span className="font-mono">{newTotalCents > 0 ? formatCents(newTotalCents) : 'Free'}</span>
              </div>
              {newTotalCents !== currentTotalCents ? (
                <div className="text-[11px] text-gray-500 text-right">
                  Currently {formatCents(currentTotalCents)} / mo —{' '}
                  <span className={newTotalCents > currentTotalCents ? 'text-amber-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                    {newTotalCents > currentTotalCents ? '+' : ''}
                    {formatCents(newTotalCents - currentTotalCents)}
                  </span>
                </div>
              ) : null}
            </div>

            {/* What happens next */}
            {willStartTrial ? (
              <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-900 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles size={14} /> Start your {trialDuration || 'free trial'}
                </p>
                <p className="text-xs">
                  You won&apos;t be charged today. Your trial unlocks <strong>{plan.name}</strong>{' '}
                  immediately. {plan.trial_period_unit === 'forever'
                    ? 'No future charges — ever.'
                    : <>Your first <strong>{formatCents(newTotalCents)}/mo</strong> charge fires when the trial ends — you can add a card any time before then.</>}
                </p>
              </div>
            ) : isDowngradeToFree ? (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
                <p>
                  You&apos;ll be moved to the <strong>{plan.name}</strong> plan immediately. Your
                  current paid subscription will be canceled with LunarPay and you won&apos;t be
                  charged again.
                </p>
              </div>
            ) : willPatch ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-1">
                <p>
                  Your monthly charge will change to <strong>{formatCents(newTotalCents)}</strong> on the
                  card ending in <strong>•••• {paymentMethod?.last4 || '––––'}</strong>.
                </p>
                <p className="text-xs">Next bill estimate: {nextBillEstimate}</p>
              </div>
            ) : willCharge ? (
              <div className="space-y-2">
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                  <p>
                    You&apos;ll be sent to <strong>LunarPay&apos;s secure checkout</strong> to enter
                    your card details. Your subscription activates the moment payment succeeds.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Lock size={11} />
                  <span>Payments are PCI-compliant. We never see or store your card number.</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="px-6 pb-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Keep current plan
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : willCharge ? (
                <Lock size={12} />
              ) : (
                <Check size={12} />
              )}
              {willStartTrial
                ? 'Start free trial'
                : willCharge
                  ? 'Continue to secure checkout'
                  : isDowngradeToFree
                    ? 'Switch to free'
                    : 'Confirm change'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmTone = 'primary',
  confirmBusy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  confirmTone?: 'primary' | 'danger';
  confirmBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6">
          <h3 className="font-heading text-lg text-gray-900">{title}</h3>
          <div className="mt-2 text-sm text-gray-600">{body}</div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Keep current
            </button>
            <button
              type="button"
              disabled={confirmBusy}
              onClick={onConfirm}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                confirmTone === 'danger' ? 'bg-red-600 hover:bg-red-700' : ''
              }`}
              style={confirmTone === 'primary' ? { backgroundColor: BRAND } : undefined}
            >
              {confirmBusy ? <Loader2 size={12} className="animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
