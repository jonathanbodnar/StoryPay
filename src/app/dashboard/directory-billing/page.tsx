'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  CheckCircle2,
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
  verifiedFromPlan: boolean;
  sponsoredFromPlan: boolean;
  verifiedUser: boolean;
  sponsoredUser: boolean;
};

type ChargeBreakdown = {
  plan_cents: number;
  verified_cents: number;
  sponsored_cents: number;
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
  addon_prices: { verified_cents: number; sponsored_cents: number };
  trial: TrialState;
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

  async function toggleAddon(kind: 'verified' | 'sponsored') {
    if (!summary) return;
    const next = !summary.addons[kind === 'verified' ? 'verifiedUser' : 'sponsoredUser'];
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
      setInfo(
        next
          ? `${kind === 'verified' ? 'Verified Listing' : 'Sponsored Listing'} added — your monthly bill is being updated.`
          : `${kind === 'verified' ? 'Verified Listing' : 'Sponsored Listing'} removed — your monthly bill will be reduced on the next cycle.`,
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

      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Current plan
            </div>
            <h2 className="mt-1 font-heading text-xl text-gray-900">
              {currentPlan?.name ?? 'No plan assigned'}
            </h2>
            {currentPlan?.description ? (
              <p className="mt-1 text-sm text-gray-600">{currentPlan.description}</p>
            ) : null}
            <div className="mt-2 text-sm text-gray-700">
              {currentCents > 0 ? (
                <>
                  <span className="font-semibold text-gray-900">
                    {formatCents(currentCents)}
                  </span>{' '}
                  / month
                </>
              ) : (
                <>No monthly charge.</>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 sm:items-end text-xs">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${
                isActive
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : isPastDue
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : status === 'canceled'
                      ? 'border-gray-200 bg-gray-50 text-gray-600'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <ShieldCheck size={11} /> {status.replace(/_/g, ' ') || 'none'}
            </span>
            {summary.subscription?.next_payment_on ? (
              <span className="text-gray-500">
                Next bill: {formatDate(summary.subscription.next_payment_on)}
              </span>
            ) : null}
          </div>
        </div>

        {isActive || isPastDue ? (
          <div className="mt-5 pt-5 border-t border-gray-100 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy === 'update_pm'}
              onClick={() => void updatePaymentMethod()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === 'update_pm' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CreditCard size={12} />
              )}
              Update payment method
            </button>
            <button
              type="button"
              disabled={busy === 'cancel'}
              onClick={() => setConfirmCancel(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              {busy === 'cancel' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
              Cancel subscription
            </button>
          </div>
        ) : null}
      </section>

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
                    ? ` · expires ${summary.payment_method.exp_month}/${String(
                        summary.payment_method.exp_year,
                      ).slice(-2)}`
                    : ''}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              No card on file. {currentCents > 0 ? 'Resume checkout to add one.' : 'Switch to a paid plan to add a payment method.'}
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
              {busy === 'update_pm' ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <CreditCard size={12} />
              )}
              Update payment method
            </button>
          ) : null}
        </div>
      </section>

      {/* ── Add-ons (current plan) ─────────────────────────────────────── */}
      <AddonsCard
        addons={summary.addons}
        charge={summary.charge}
        verifiedPriceCents={summary.addon_prices.verified_cents}
        sponsoredPriceCents={summary.addon_prices.sponsored_cents}
        currentPlan={currentPlan}
        busy={busy}
        onToggle={(kind) => void toggleAddon(kind)}
      />

      <section>
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="font-heading text-lg text-gray-900">Available plans</h2>
            <p className="text-sm text-gray-500">
              Upgrade or downgrade anytime. Paid plans bill monthly; changes apply instantly.
              Verified &amp; Sponsored add-ons can be added to any plan.
            </p>
          </div>
        </div>

        {plans.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
            No directory plans are available yet. An admin needs to configure plans in the super admin
            dashboard.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = currentPlan?.id === plan.id && (isActive || isPastDue);
              const isPendingThis = currentPlan?.id === plan.id && isPending;
              const cents = plan.price_monthly_cents ?? 0;
              const inclusion = summary.plan_addon_inclusion[plan.id] || { verified: false, sponsored: false };
              // Preview total at the *plan being viewed*, with the user's currently-active
              // addons retained (they don't reset when changing plan).
              const verifiedAdds = !inclusion.verified && summary.addons.verifiedUser
                ? summary.addon_prices.verified_cents : 0;
              const sponsoredAdds = !inclusion.sponsored && summary.addons.sponsoredUser
                ? summary.addon_prices.sponsored_cents : 0;
              const previewTotal = cents + verifiedAdds + sponsoredAdds;
              const previewDelta = previewTotal - summary.charge.total_cents;
              const isUpgrade = previewDelta > 0;
              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-5 flex flex-col gap-3 ${
                    isCurrent ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div>
                    <div
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        isCurrent ? 'text-gray-300' : 'text-gray-400'
                      }`}
                    >
                      {cents > 0 ? 'Paid' : 'Free'}
                      {plan.is_default ? ' · default' : ''}
                    </div>
                    <div
                      className={`mt-1 font-heading text-lg ${
                        isCurrent ? 'text-white' : 'text-gray-900'
                      }`}
                    >
                      {plan.name}
                    </div>
                    {plan.description ? (
                      <p
                        className={`mt-1 text-sm ${
                          isCurrent ? 'text-gray-300' : 'text-gray-600'
                        }`}
                      >
                        {plan.description}
                      </p>
                    ) : null}
                  </div>
                  <div
                    className={`text-2xl font-bold ${
                      isCurrent ? 'text-white' : 'text-gray-900'
                    }`}
                  >
                    {cents > 0 ? formatCents(cents) : 'Free'}
                    {cents > 0 ? (
                      <span
                        className={`text-xs font-medium ${
                          isCurrent ? 'text-gray-300' : 'text-gray-500'
                        }`}
                      >
                        {' '}
                        / month
                      </span>
                    ) : null}
                  </div>

                  {/* Trial badge — shown when this plan offers a trial */}
                  {planHasTrial(plan) ? (
                    <div className={`inline-flex items-center gap-1 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      isCurrent
                        ? 'bg-violet-400/20 text-violet-100'
                        : 'bg-violet-50 text-violet-700 border border-violet-100'
                    }`}>
                      <Sparkles size={11} />
                      {formatTrialDuration(plan)}
                    </div>
                  ) : null}

                  {/* What this plan bundles for free */}
                  <div className="space-y-1.5">
                    <div className={`text-[11px] font-semibold uppercase tracking-wide ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>
                      Add-ons included
                    </div>
                    <PlanIncludedRow
                      label="Verified Listing"
                      value="$19/mo"
                      included={inclusion.verified}
                      isCurrent={isCurrent}
                    />
                    <PlanIncludedRow
                      label="Sponsored Listing"
                      value="$99/mo"
                      included={inclusion.sponsored}
                      isCurrent={isCurrent}
                    />
                  </div>

                  {/* Preview total if user switches to this plan keeping their existing addons. */}
                  {!isCurrent && (verifiedAdds > 0 || sponsoredAdds > 0) ? (
                    <div className={`rounded-lg px-3 py-2 text-[11px] ${
                      isCurrent ? 'bg-white/10 text-gray-200' : 'bg-gray-50 text-gray-600'
                    }`}>
                      Total with your current add-ons:{' '}
                      <span className="font-semibold text-gray-900">
                        {formatCents(previewTotal)}
                      </span>{' '}
                      / mo
                      {previewDelta !== 0 ? (
                        <span className={previewDelta > 0 ? 'ml-1 text-amber-700' : 'ml-1 text-emerald-700'}>
                          ({previewDelta > 0 ? '+' : ''}
                          {formatCents(previewDelta)})
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-auto">
                    {isCurrent ? (
                      <span className="inline-flex w-full justify-center items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold">
                        <Check size={12} /> Current plan
                      </span>
                    ) : isPendingThis ? (
                      <span className="inline-flex w-full justify-center items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                        <AlertTriangle size={12} /> Complete checkout above
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === `change:${plan.id}` || isPending}
                        onClick={() => setConfirmPlanId(plan.id)}
                        className="inline-flex w-full justify-center items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
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
                            : isUpgrade
                              ? 'Upgrade'
                              : 'Switch plan'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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

/**
 * One-row helper that shows whether a plan bundles a given add-on.
 * Renders "Included" pill OR price string depending on inclusion.
 */
function PlanIncludedRow({
  label,
  value,
  included,
  isCurrent,
}: {
  label: string;
  value: string;
  included: boolean;
  isCurrent: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className={isCurrent ? 'text-gray-200' : 'text-gray-700'}>{label}</span>
      {included ? (
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          isCurrent ? 'bg-emerald-400/20 text-emerald-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
        }`}>
          <Check size={10} /> Included
        </span>
      ) : (
        <span className={`text-[11px] ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>{value}</span>
      )}
    </div>
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
  tone: 'emerald' | 'violet';
}) {
  const ringClass = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50/40'
    : 'border-violet-200 bg-violet-50/40';
  const checkboxBg = isOn
    ? tone === 'emerald'
      ? 'bg-emerald-600 border-emerald-600'
      : 'bg-violet-600 border-violet-600'
    : 'bg-white border-gray-300';
  return (
    <label
      htmlFor={`addon-${label}`}
      className={`relative flex flex-col gap-2 rounded-xl border p-4 cursor-pointer transition-colors ${
        isOn ? ringClass : 'border-gray-200 bg-white hover:bg-gray-50'
      } ${isFromPlan ? 'cursor-default' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-lg ${
            tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
          }`}>
            {icon}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              {label}
              {isFromPlan ? (
                <span className="rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  Included
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-gray-600 leading-relaxed">{description}</p>
            <div className="mt-1.5 text-[11px] text-gray-500">
              {isFromPlan
                ? 'Bundled with your current plan at no extra charge.'
                : `${formatCents(priceCents)} / month`}
            </div>
          </div>
        </div>
        <button
          type="button"
          id={`addon-${label}`}
          aria-checked={isOn}
          role="checkbox"
          disabled={isFromPlan || busy}
          onClick={(e) => {
            e.preventDefault();
            if (!isFromPlan) onChange();
          }}
          className={`flex-shrink-0 mt-1 inline-flex h-5 w-5 items-center justify-center rounded border-2 transition ${checkboxBg} ${
            isFromPlan ? 'opacity-90' : ''
          } disabled:opacity-50`}
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin text-gray-700" />
          ) : isOn ? (
            <Check size={12} className="text-white" strokeWidth={3} />
          ) : null}
        </button>
      </div>
      {isFromPlan && !isUserOn ? (
        <div className="text-[10px] text-emerald-700 font-medium pl-12">
          Active automatically while you&apos;re on this plan.
        </div>
      ) : null}
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
  onCancel,
  onConfirm,
}: {
  plan: Plan;
  currentPlan: Plan | null;
  currentTotalCents: number;
  targetInclusion: { verified: boolean; sponsored: boolean };
  addons: Addons;
  addonPrices: { verified_cents: number; sponsored_cents: number };
  paymentMethod: PaymentMethod;
  trial: TrialState;
  subscriptionExists: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const planCents = plan.price_monthly_cents ?? 0;
  // Total they'll be charged on the new plan, retaining their current addon toggles.
  const verifiedAdds = !targetInclusion.verified && addons.verifiedUser ? addonPrices.verified_cents : 0;
  const sponsoredAdds = !targetInclusion.sponsored && addons.sponsoredUser ? addonPrices.sponsored_cents : 0;
  const newTotalCents = planCents + verifiedAdds + sponsoredAdds;

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

              {/* Show addon line items */}
              {(verifiedAdds > 0 || sponsoredAdds > 0 || targetInclusion.verified || targetInclusion.sponsored) && (
                <div className="border-t border-gray-200 pt-2 space-y-1 text-xs text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Verified Listing</span>
                    <span className="font-mono">
                      {targetInclusion.verified ? 'Included' : verifiedAdds > 0 ? formatCents(verifiedAdds) : addons.verifiedUser ? formatCents(addonPrices.verified_cents) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Sponsored Listing</span>
                    <span className="font-mono">
                      {targetInclusion.sponsored ? 'Included' : sponsoredAdds > 0 ? formatCents(sponsoredAdds) : addons.sponsoredUser ? formatCents(addonPrices.sponsored_cents) : '—'}
                    </span>
                  </div>
                </div>
              )}
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
