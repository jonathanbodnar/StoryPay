'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  CreditCard,
  Loader2,
  Receipt,
  ShieldCheck,
  X,
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

type BillingSummary = {
  venue: { id: string; name: string; email: string | null };
  current_plan: Plan | null;
  subscription: Subscription;
  subscription_status: string;
  payment_method: PaymentMethod;
  plans: Plan[];
  history: HistoryEntry[];
  billing_configured: boolean;
};

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
        setError(d.error || 'Could not load billing');
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
    let cancelled = false;
    (async () => {
      setBusy(paymentUpdate ? 'verify_payment_update' : 'verify_checkout');
      setError('');
      try {
        const endpoint = paymentUpdate
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
          setInfo(paymentUpdate ? 'Payment method updated.' : 'Subscription activated.');
          router.replace('/dashboard/directory-billing');
          await load();
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Verification failed');
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
      setError(e instanceof Error ? e.message : 'Plan change failed');
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
      setError(e instanceof Error ? e.message : 'Could not start payment update');
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
      setError(e instanceof Error ? e.message : 'Cancel failed');
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
  const confirmTarget = confirmPlanId ? plans.find((p) => p.id === confirmPlanId) : null;

  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="font-heading text-2xl text-gray-900 flex items-center gap-2">
          <CreditCard size={22} className="text-gray-700" /> Plans &amp; billing
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your StoryPay directory plan, update your card on file, and review past invoices.
          Billing is handled securely by LunarPay.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {info}
        </div>
      ) : null}
      {busy === 'verify_checkout' || busy === 'verify_payment_update' ? (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Confirming with LunarPay…
        </div>
      ) : null}
      {!summary.billing_configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          LunarPay platform billing isn&apos;t configured on the server yet. Plan switches that require
          payment will fail until an admin sets <code>STORYPAY_PLATFORM_LUNARPAY_SECRET_KEY</code>.
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
              No card on file. Switch to a paid plan to add a payment method.
            </p>
          )}
          {currentCents > 0 ? (
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
              {summary.payment_method ? 'Update payment method' : 'Add payment method'}
            </button>
          ) : null}
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="font-heading text-lg text-gray-900">Available plans</h2>
            <p className="text-sm text-gray-500">
              Upgrade or downgrade anytime. Paid plans bill monthly; changes apply instantly.
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
              const isCurrent = currentPlan?.id === plan.id;
              const cents = plan.price_monthly_cents ?? 0;
              const isUpgrade = cents > currentCents;
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
                  <div className="mt-auto">
                    {isCurrent ? (
                      <span className="inline-flex w-full justify-center items-center gap-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold">
                        <Check size={12} /> Current plan
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === `change:${plan.id}`}
                        onClick={() => setConfirmPlanId(plan.id)}
                        className="inline-flex w-full justify-center items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: BRAND }}
                      >
                        {busy === `change:${plan.id}` ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <ArrowUpRight size={12} />
                        )}
                        {cents === 0 ? 'Switch to free' : isUpgrade ? 'Upgrade' : 'Switch plan'}
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
        <ConfirmDialog
          title={`Switch to ${confirmTarget.name}?`}
          body={
            (confirmTarget.price_monthly_cents ?? 0) === 0 ? (
              <>
                You&apos;ll be moved to the <strong>{confirmTarget.name}</strong> plan immediately.
                Any active paid subscription will be canceled with LunarPay. You can upgrade again at
                any time.
              </>
            ) : currentCents > 0 ? (
              <>
                Your monthly charge will change to{' '}
                <strong>{formatCents(confirmTarget.price_monthly_cents)}</strong>. LunarPay updates the
                subscription amount, so the next bill uses the new price.
              </>
            ) : (
              <>
                You&apos;ll be sent to LunarPay to add a card and start your{' '}
                <strong>{confirmTarget.name}</strong> subscription at{' '}
                <strong>{formatCents(confirmTarget.price_monthly_cents)}</strong> / month.
              </>
            )
          }
          confirmLabel="Switch plan"
          confirmBusy={busy === `change:${confirmTarget.id}`}
          onCancel={() => setConfirmPlanId(null)}
          onConfirm={() => void changePlan(confirmTarget.id)}
        />
      ) : null}

      {confirmCancel ? (
        <ConfirmDialog
          title="Cancel your StoryPay directory subscription?"
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
