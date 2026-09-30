'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Loader2,
  Lock,
  Receipt,
  ShieldCheck,
  Gem,
  Sparkles,
  X,
  AlertTriangle,
} from 'lucide-react';
import DashboardBookingModal from '@/components/DashboardBookingModal';
import { isNativeApp, openExternalBrowser } from '@/lib/platform';

const BRAND = '#1b1b1b';

/**
 * Send the user to a LunarPay checkout URL. On the native shell this opens the
 * external system browser (so the purchase flow is never inside the app
 * webview — Apple/Play requirement); on the web it navigates in place exactly
 * as before.
 */
async function redirectToCheckout(url: string): Promise<void> {
  if (isNativeApp()) {
    await openExternalBrowser(url);
    return;
  }
  window.location.href = url;
}

/**
 * Plan feature checklist shown inside each plan's accordion body. The list is
 * cumulative: `minTier` is the lowest plan tier (0 = cheapest plan, ascending
 * by tier) that unlocks the feature. A plan shows a check when its tier ≥
 * minTier, otherwise a red lock. This mirrors the public pricing page where
 * each higher tier is "everything below, plus …".
 *
 *   Tier 0 → Bride Booking System Free
 *   Tier 1 → Bride Booking System ($/mo)
 *   Tier 2 → All-Inclusive
 *   Tier 3 → All-Inclusive Concierge
 */
type PlanFeature = { label: string; outcome: string; minTier: number };

/**
 * The core product we sell — the "Bride Booking System". These features are
 * bundled as one thing and rendered inside a bordered box so customers can see
 * the product boundary at a glance, separate from premium services + add-ons.
 */
const BOOKING_SYSTEM_FEATURES: PlanFeature[] = [
  { label: 'Venue Listing',        outcome: 'Appear in the wedding directory so couples can find you',     minTier: 0 },
  { label: 'Verified Listing',     outcome: 'Verified badge on your listing — builds trust with couples',  minTier: 0 },
  { label: 'Reviews',              outcome: 'Collect and showcase reviews on your listing',                minTier: 1 },
  { label: 'Pricing Guide',        outcome: 'Share your pricing with couples in a polished branded guide', minTier: 1 },
  { label: 'Speed to Lead System', outcome: 'Reply the instant a bride inquires',                          minTier: 1 },
  { label: 'Lead Inbox',           outcome: 'Track, qualify, and convert every inquiry into a booking',    minTier: 1 },
  { label: 'Conversations',        outcome: 'Unified inbox for all client messages and inquiries',         minTier: 1 },
  { label: 'Booking Calendar',     outcome: 'Block dates, track bookings, and sync availability',          minTier: 1 },
  { label: 'Proposals & Payments', outcome: 'Send proposals, collect deposits, and track payments',        minTier: 0 },
  { label: 'Contact Management',   outcome: 'Manage every lead and client in one place',                   minTier: 0 },
  { label: 'Analytics',            outcome: 'Revenue insights, booking trends, and performance data',      minTier: 1 },
];

/**
 * Display order for plan accordions and cumulative feature tiers. Plans aren't
 * ordered by stored price (the All-Inclusive tiers hide their price and aren't
 * reliably ordered by it) — we rank by what the plan *is*:
 *   0 Free · 1 Bride Booking System · 2 All-Inclusive · 3 All-Inclusive Concierge
 */
function planRank(p: { name: string; price_monthly_cents: number | null; is_default?: boolean }): number {
  const n = p.name.toLowerCase();
  if (n.includes('concierge')) return 3;
  if (n.includes('all-inclusive') || n.includes('all inclusive')) return 2;
  if (p.is_default || (p.price_monthly_cents ?? 0) === 0 || n.includes('free')) return 0;
  return 1;
}

/** Present plan names with a capital "I" in All-Inclusive. */
function displayPlanName(name: string): string {
  return name.replace(/all-inclusive/gi, 'All-Inclusive');
}

/** One feature row with an unlocked (check) or locked state. */
function FeatureRow({ feature, on }: { feature: PlanFeature; on: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
        on ? 'bg-emerald-100 text-emerald-600' : 'bg-red-50 text-red-400'
      }`}>
        {on ? <Check size={10} strokeWidth={3} /> : <Lock size={9} strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold leading-tight text-gray-900">{feature.label}</div>
        <div className="text-[11px] leading-snug text-gray-500">{feature.outcome}</div>
      </div>
    </div>
  );
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
  /** Hide price + replace upgrade CTA with "Book a call" for non-subscribers. */
  contact_sales?: boolean;
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
  /** Plain description from the server (older responses may lack it). */
  label?: string;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  plan_id: string | null;
  plan_name: string | null;
  external_event_id: string | null;
  status: 'paid' | 'refunded' | 'failed' | 'pending' | 'info';
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
  billing_provider?: 'stripe' | 'lunarpay' | null;
  stripe_move_available?: boolean;
  /** Plan and add-on changes are locked (private client on a plan-only price). */
  plan_changes_locked?: boolean;
  /** The venue cancelled: its plan stays on until this date, then it moves to Free. */
  scheduled_downgrade_at?: string | null;
  /** The pending cancel can be undone ("Keep my plan"). */
  can_keep_plan?: boolean;
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

/** Cancel reasons; keys match /api/venue-billing/cancel. */
const CANCEL_REASONS: { key: string; label: string }[] = [
  { key: 'too_expensive', label: 'It costs too much' },
  { key: 'not_enough_leads', label: 'Not getting enough leads or bookings' },
  { key: 'missing_feature', label: 'Missing something I need' },
  { key: 'hard_to_use', label: 'Too hard to use' },
  { key: 'switching', label: 'Switching to another tool' },
  { key: 'closing', label: 'Closing or pausing my venue' },
  { key: 'other', label: 'Something else' },
];

/** Private clients on a plan-only price (matches the server's PLAN_CHANGES_LOCKED_MESSAGE). */
const PLAN_LOCKED_NOTE = 'Your plan is managed by your StoryVenue team. Contact us to change your plan or add-ons.';

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
    return 'Our payment processor is temporarily unavailable. Please try again in a moment.';
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
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

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
    const target = summary?.plans.find((p) => p.id === planId);
    if (summary?.plan_changes_locked && (target?.price_monthly_cents ?? 0) > 0) {
      setError(PLAN_LOCKED_NOTE);
      return;
    }
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
        | { kind: 'scheduled'; plan_id: string; downgrade_at: string }
        | { error?: string };
      if (!res.ok) throw new Error((d as { error?: string }).error || 'Plan change failed');
      if ((d as { kind?: string }).kind === 'checkout_required') {
        void redirectToCheckout((d as { url: string }).url);
        return;
      }
      if ((d as { kind?: string }).kind === 'scheduled') {
        setInfo(`Done. You'll keep your current plan until ${formatDate((d as { downgrade_at: string }).downgrade_at)}, then move to ${target ? displayPlanName(target.name) : 'the Free plan'}.`);
      } else {
        setInfo('Plan updated.');
      }
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
      if (d.url) void redirectToCheckout(d.url);
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
      if (d.url) void redirectToCheckout(d.url);
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
      if (d.url) void redirectToCheckout(d.url);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Could not start paid checkout'));
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
      const res = await fetch('/api/venue-billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason || undefined, note: cancelNote.trim() || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { kind?: 'scheduled' | 'downgraded'; downgradeAt?: string; error?: string };
      if (!res.ok) throw new Error(d.error || 'Cancel failed');
      setInfo(
        d.kind === 'scheduled' && d.downgradeAt
          ? `Subscription canceled. You'll keep your plan until ${formatDate(d.downgradeAt)}, then move to the Free plan. You won't be charged again.`
          : "Subscription canceled. You're now on the Free plan and won't be charged again.",
      );
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Cancel failed'));
    } finally {
      setBusy(null);
    }
  }

  async function keepPlan() {
    setBusy('keep_plan');
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/venue-billing/keep-plan', { method: 'POST' });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || 'Could not keep your plan');
      setInfo('Your plan is back on and will renew as usual.');
      await load();
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : 'Could not keep your plan'));
    } finally {
      setBusy(null);
    }
  }

  const plans = useMemo(() => {
    if (!summary) return [] as Plan[];
    // Explicit display order: Free → Bride Booking System → All-Inclusive →
    // All-Inclusive Concierge. (The All-Inclusive tiers hide their price, so a
    // raw price sort doesn't reliably put them in the right order.)
    return [...summary.plans].sort((a, b) => {
      const r = planRank(a) - planRank(b);
      return r !== 0 ? r : (a.price_monthly_cents ?? 0) - (b.price_monthly_cents ?? 0);
    });
  }, [summary]);

  // The cheapest *paid* plan is the only self-serve paid tier. Any plan priced
  // above it (e.g. the All-Inclusive tiers) is contact-sales: price hidden,
  // upgrade replaced with "Book a Demo Call". This keeps premium pricing off
  // the page entirely — it's only ever shared on a demo call.
  const basePaidCents = useMemo(() => {
    const paid = plans.map((p) => p.price_monthly_cents ?? 0).filter((c) => c > 0);
    return paid.length ? Math.min(...paid) : 0;
  }, [plans]);

  // Tier of each plan (0 = Free) used to drive the cumulative feature
  // checklist — higher tiers include everything below them.
  const tierIndexById = useMemo(() => {
    const m = new Map<string, number>();
    plans.forEach((p) => m.set(p.id, planRank(p)));
    return m;
  }, [plans]);

  // Native app store shell: never render plan pricing / upgrade / cancel /
  // update-card UI inside the app webview (Apple 3.1.1). All billing is
  // managed in the system browser instead.
  if (isNativeApp()) {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
          <CreditCard size={22} className="text-gray-700" />
        </div>
        <h1 className="font-heading text-xl text-gray-900">Manage billing on the web</h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-500">
          Plans, billing, and payment details are managed from your account on the web.
          Open your account in the browser to continue.
        </p>
        <button
          type="button"
          onClick={() => void openExternalBrowser('/dashboard/directory-billing')}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1b1b1b] text-sm font-semibold text-white transition hover:bg-black"
        >
          Open in browser <ExternalLink size={15} />
        </button>
        <p className="mt-3 text-xs text-gray-400">app.storyvenue.com</p>
      </div>
    );
  }

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
  // Legacy clients are billed externally — the entire plan/billing page is
  // hidden from them. We render a brief notice and bounce to the dashboard.
  if (summary.is_legacy_plan) {
    if (typeof window !== 'undefined') {
      // Fire-and-forget hard redirect so the back button doesn't return here.
      window.setTimeout(() => router.replace('/dashboard'), 1200);
    }
    return (
      <div className="max-w-xl py-12">
        <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
          <Lock size={22} className="text-gray-700" /> Billing managed directly
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Your account is on a legacy plan. Billing is handled directly with your
          account manager — no subscription page is available here.
        </p>
        <p className="mt-3 text-xs text-gray-400">Redirecting you back to your dashboard…</p>
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
  // Cancelled: the plan stays on until this date, then the venue moves to Free.
  const scheduledEnd = summary.scheduled_downgrade_at ?? null;
  // Where a cancel would land: the end of the paid term (or carded trial).
  const termEndsAt = isActive ? summary.subscription?.next_payment_on ?? null : null;
  const currentPlanLabel = currentPlan ? displayPlanName(currentPlan.name) : 'your plan';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
          <CreditCard size={22} className="text-gray-700" /> Plans &amp; billing
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your StoryVenue plan, update your card on file, and review past invoices.
          Billing is processed securely.
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
          <Loader2 size={14} className="animate-spin" /> Confirming with our merchant processor…
        </div>
      ) : null}
      {summary.stripe_move_available ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>Update your billing card</strong> — StoryVenue billing is moving to a new, more secure
            processor. Add your card once (about a minute). You won&apos;t be charged until your next
            billing date.
          </span>
          <button
            type="button"
            onClick={async () => {
              setError('');
              try {
                const res = await fetch('/api/venue-billing/stripe/move-to-stripe', { method: 'POST' });
                const d = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
                if (!res.ok || !d.url) throw new Error(d.error || 'Could not start the card update.');
                void redirectToCheckout(d.url);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not start the card update.');
              }
            }}
            className="rounded-lg bg-[#1b1b1b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
          >
            Update billing card
          </button>
        </div>
      ) : null}
      {!summary.billing_configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Billing isn&apos;t fully set up on our end yet. Please reach out to support and we&apos;ll get
          you sorted right away.
        </div>
      ) : null}

      {/* Trial banner — only shown during an active trial (not expired — everyone
          has a card on file from onboarding, so LunarPay auto-charges at trial
          end; the past-due wall handles any failed charge automatically). */}
      {scheduledEnd ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Calendar size={18} className="mt-0.5 flex-shrink-0 text-amber-700" />
              <div>
                <h3 className="font-semibold text-amber-900">
                  {currentPlan ? displayPlanName(currentPlan.name) : 'Your plan'} ends {formatDate(scheduledEnd)}
                </h3>
                <p className="mt-1 text-sm text-amber-800">
                  Your subscription is canceled, so you won&apos;t be charged again. Everything stays on until
                  then. After that your venue moves to the Free plan, and your listing, leads and account stay
                  on StoryVenue.
                </p>
              </div>
            </div>
            {summary.can_keep_plan ? (
              <button
                type="button"
                onClick={() => void keepPlan()}
                disabled={busy === 'keep_plan'}
                className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50 sm:self-auto"
                style={{ backgroundColor: BRAND }}
              >
                {busy === 'keep_plan' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Keep my plan
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!scheduledEnd && (summary.trial.status === 'active' || summary.trial.status === 'forever') ? (
        <TrialActiveBanner
          trial={summary.trial}
          chargeTotalCents={summary.charge.total_cents}
          hasPaymentMethod={Boolean(summary.payment_method)}
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

        {summary.plan_changes_locked && (
          <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            {PLAN_LOCKED_NOTE}
          </div>
        )}

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
              // contact_sales: hide price + show "Book a call" only for non-subscribers.
              // Current subscribers always see full self-serve controls.
              // Treat as contact_sales if the DB flag is set OR if the plan is
              // priced above the base paid tier (the All-Inclusive tiers).
              const isContactSales =
                (Boolean(plan.contact_sales) || (cents > 0 && cents > basePaidCents)) && !isCurrent;
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
                          {displayPlanName(plan.name)}
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
                        {isContactSales ? (
                          <div className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">
                            <Calendar size={10} /> Book a call
                          </div>
                        ) : (
                          <>
                            <div className="font-bold text-sm text-gray-900">
                              {cents > 0 ? formatCents(cents) : 'Free'}
                              {cents > 0 && <span className="text-xs font-normal ml-0.5 text-gray-500">/mo</span>}
                            </div>
                            {isCurrent && scheduledEnd ? (
                              <div className="text-[10px] text-amber-700">Ends {formatDate(scheduledEnd)}</div>
                            ) : summary.subscription?.next_payment_on && isCurrent ? (
                              <div className="text-[10px] text-gray-400">Next: {formatDate(summary.subscription.next_payment_on)}</div>
                            ) : null}
                          </>
                        )}
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

                        {/* The Bride Booking System — our core product, boxed off
                            so it reads as one distinct thing customers are buying. */}
                        <div className="rounded-xl border border-gray-300 bg-white p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#1b1b1b] text-white">
                              <Gem size={11} />
                            </span>
                            <span className="text-[13px] font-bold tracking-tight text-gray-900">
                              The Bride Booking System™
                            </span>
                          </div>
                          <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                            {BOOKING_SYSTEM_FEATURES.map((f) => {
                              const tier = tierIndexById.get(plan.id) ?? 0;
                              const on = tier >= f.minTier;
                              return <FeatureRow key={f.label} feature={f} on={on} />;
                            })}
                          </div>
                        </div>

                      </div>


                      {/* ── Monthly total breakdown — hidden for contact-sales tiers ── */}
                      {!isContactSales && (
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-wide mb-3 text-gray-500">
                          Monthly total
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between text-gray-700">
                            <span>{displayPlanName(plan.name)}</span>
                            <span className="font-mono">{cents > 0 ? formatCents(cents) : 'Free'}</span>
                          </div>
                        </div>
                        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                          Pricing subject to change at any time. Subscribers receive at least 30 days&apos; advance notice before any price increase.
                        </p>
                      </div>
                      )}

                      {/* ── Actions ── */}
                      {isCurrent ? (
                        scheduledEnd ? (
                          <p className="text-xs text-gray-500">
                            Canceled. This plan stays on until {formatDate(scheduledEnd)}, then your venue moves to the
                            Free plan.
                          </p>
                        ) : (isActive || isPastDue) ? (
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
                      ) : isContactSales ? (
                        <div className="space-y-3">
                          <button
                            type="button"
                            onClick={() => setBookingModalOpen(true)}
                            className="w-full flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                            style={{ backgroundColor: BRAND }}
                          >
                            <Calendar size={16} />
                            Book a Demo Call
                          </button>
                          <p className="text-[11px] text-gray-400 leading-snug text-center">
                            See the full platform in action. Free 30-minute demo — no pressure.
                          </p>
                        </div>
                      ) : scheduledEnd && cents === 0 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-xs font-semibold text-gray-700">
                          <Calendar size={12} /> Starts {formatDate(scheduledEnd)}
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
              {scheduledEnd
                ? 'No card needed. Your subscription is canceled and won’t renew.'
                : currentCents > 0
                  ? 'No card on file. Add one to keep your subscription active.'
                  : 'No card on file. Switch to a paid plan to add a payment method.'}
            </p>
          )}
          {/*
            Always offer the button on paid plans, even when no card is on
            file — this is the only path a venue has to add a new card after
            their saved card was removed (or to swap it out before renewal).
            Free plans don't need a card so we hide it there.
          */}
          {currentCents > 0 && !scheduledEnd ? (
            <button
              type="button"
              disabled={busy === 'update_pm'}
              onClick={() => void updatePaymentMethod()}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: BRAND }}
            >
              {busy === 'update_pm' ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
              {summary.payment_method ? 'Update payment method' : 'Add card'}
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
                    <td className="px-6 py-3 text-gray-700">{row.label || humaniseEventType(row.event_type)}</td>
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
                      {row.status === 'info' && row.amount_cents === 0
                        ? '—'
                        : row.status === 'refunded' && row.amount_cents > 0
                          ? `-${formatCents(row.amount_cents)}`
                          : formatCents(row.amount_cents)}
                    </td>
                    <td className="px-6 py-3">
                      {row.status === 'info' ? null : (
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
                      )}
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
          termEndsAt={termEndsAt}
          busy={busy === `change:${confirmTarget.id}`}
          onCancel={() => setConfirmPlanId(null)}
          onConfirm={() => void changePlan(confirmTarget.id)}
        />
      ) : null}

      {confirmCancel ? (
        <ConfirmDialog
          title="Cancel your StoryVenue subscription?"
          body={
            <div className="space-y-3">
              <p>
                {termEndsAt ? (
                  <>
                    You&apos;ll keep <strong>{currentPlanLabel}</strong> until <strong>{formatDate(termEndsAt)}</strong>.
                    After that your venue moves to the Free plan and you won&apos;t be charged again. Your listing,
                    leads and account stay on StoryVenue.
                  </>
                ) : (
                  <>
                    Your venue moves to the Free plan now and you won&apos;t be charged again. Your listing, leads
                    and account stay on StoryVenue.
                  </>
                )}
              </p>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-semibold text-gray-700">What&apos;s the main reason? (optional)</legend>
                {CANCEL_REASONS.map((r) => (
                  <label key={r.key} htmlFor={`cancel-reason-${r.key}`} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      id={`cancel-reason-${r.key}`}
                      name="cancel-reason"
                      value={r.key}
                      checked={cancelReason === r.key}
                      onChange={() => setCancelReason(r.key)}
                    />
                    {r.label}
                  </label>
                ))}
              </fieldset>
              <textarea
                id="cancel-note"
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="Anything we could do better? (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800"
              />
              <p className="text-xs text-gray-500">
                Want help first?{' '}
                <button
                  type="button"
                  className="font-semibold text-gray-800 underline"
                  onClick={() => { setConfirmCancel(false); setBookingModalOpen(true); }}
                >
                  Book a free call with our team
                </button>
                .
              </p>
            </div>
          }
          confirmLabel="Cancel subscription"
          confirmTone="danger"
          confirmBusy={busy === 'cancel'}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => void cancelSubscription()}
        />
      ) : null}

      <DashboardBookingModal
        open={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
      />
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
  termEndsAt,
  busy,
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
  /** End of the paid term (or carded trial): switching to Free takes effect then. */
  termEndsAt: string | null;
  busy: boolean;
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
                    ? `Switch to ${displayPlanName(plan.name)}`
                    : willPatch
                      ? `Upgrade to ${displayPlanName(plan.name)}`
                      : `Subscribe to ${displayPlanName(plan.name)}`}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  {currentPlan ? `Currently on ${displayPlanName(currentPlan.name)}` : 'No plan currently assigned'}
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
                    {displayPlanName(plan.name)}
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

            </div>

            {/* What happens next */}
            {willStartTrial ? (
              <div className="rounded-xl border border-violet-100 bg-violet-50 p-4 text-sm text-violet-900 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Sparkles size={14} /> Start your {trialDuration || 'free trial'}
                </p>
                <p className="text-xs">
                  You won&apos;t be charged today. Your trial unlocks <strong>{displayPlanName(plan.name)}</strong>{' '}
                  immediately. {plan.trial_period_unit === 'forever'
                    ? 'No future charges — ever.'
                    : <>Your first <strong>{formatCents(newTotalCents)}/mo</strong> charge fires when the trial ends — you can add a card any time before then.</>}
                </p>
              </div>
            ) : isDowngradeToFree ? (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">
                {subscriptionExists && termEndsAt ? (
                  <p>
                    You&apos;ll keep{' '}
                    <strong>{currentPlan ? displayPlanName(currentPlan.name) : 'your current plan'}</strong> until{' '}
                    <strong>{formatDate(termEndsAt)}</strong>, then move to the{' '}
                    <strong>{displayPlanName(plan.name)}</strong> plan. Your subscription won&apos;t renew, so you
                    won&apos;t be charged again.
                  </p>
                ) : (
                  <p>
                    You&apos;ll be moved to the <strong>{displayPlanName(plan.name)}</strong> plan immediately. Your
                    current paid subscription will be canceled and you won&apos;t be charged again.
                  </p>
                )}
              </div>
            ) : willPatch ? (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-1">
                <p>
                  Your monthly charge will change to <strong>{formatCents(newTotalCents)}</strong> on the
                  card ending in <strong>•••• {paymentMethod?.last4 || '––––'}</strong>.
                </p>
                {termEndsAt ? (
                  <p className="text-xs">The new amount starts on your next billing date, {formatDate(termEndsAt)}.</p>
                ) : null}
              </div>
            ) : willCharge ? (
              <div className="space-y-2">
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                  <p>
                    You&apos;ll be sent to <strong>our secure checkout</strong> to
                    enter your card details. Your subscription activates the moment payment succeeds.
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
