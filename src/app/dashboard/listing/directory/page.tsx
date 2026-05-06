'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, BadgeCheck, Megaphone, Loader2, CheckCircle2,
  Clock, XCircle, AlertCircle, ArrowRight, Sparkles, Info,
} from 'lucide-react';
import { directoryBadgeLabel } from '@/lib/directory-badges';

// Prices are loaded dynamically from the billing summary so admin changes
// propagate here without a code deploy. These fallbacks are used only during
// the initial render before the API responds.
const verifiedPriceMonthly_FALLBACK  = 19;
const sponsoredPriceMonthly_FALLBACK = 99;

// ── Types ─────────────────────────────────────────────────────────────────

type StatusPayload = {
  directory_verified_status: string;
  directory_sponsored_status: string;
  /** User has actively subscribed to the paid add-on. */
  addonVerified: boolean;
  addonSponsored: boolean;
  /** Plan bundles the add-on at no extra charge. */
  verifiedIncluded: boolean;
  sponsoredIncluded: boolean;
  isHighestPlan: boolean;
  /** Manually-billed legacy plan — all add-ons included, no upgrade path. */
  isLegacyPlan?: boolean;
  planName: string | null;
};

// ── Style helpers ─────────────────────────────────────────────────────────

const CARD = 'rounded-3xl border border-gray-200 bg-white';

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    approved: {
      label: 'Active',
      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: <CheckCircle2 size={13} />,
    },
    pending: {
      label: 'Pending review',
      cls: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: <Clock size={13} />,
    },
    draft: {
      label: 'In progress',
      cls: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: <Clock size={13} />,
    },
    rejected: {
      label: 'Rejected',
      cls: 'bg-red-50 text-red-700 border-red-200',
      icon: <XCircle size={13} />,
    },
    none: {
      label: 'Not active',
      cls: 'bg-gray-100 text-gray-500 border-gray-200',
      icon: null,
    },
  };
  const s = map[status] ?? map.none;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function ListingDirectoryStatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'verified' | 'sponsored' | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);
  const [verifiedPriceMonthly,  setVerifiedPriceMonthly]  = useState(verifiedPriceMonthly_FALLBACK);
  const [sponsoredPriceMonthly, setSponsoredPriceMonthly] = useState(sponsoredPriceMonthly_FALLBACK);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, pricesRes] = await Promise.all([
        fetch('/api/listing/directory-status', { cache: 'no-store' }),
        fetch('/api/admin/addon-prices').catch(() => null),
      ]);
      if (!statusRes.ok) throw new Error('Could not load status');
      setData((await statusRes.json()) as StatusPayload);
      if (pricesRes?.ok) {
        const prices = (await pricesRes.json()) as {
          verified_cents?: number;
          sponsored_cents?: number;
        };
        if (prices.verified_cents)  setVerifiedPriceMonthly(Math.round(prices.verified_cents / 100));
        if (prices.sponsored_cents) setSponsoredPriceMonthly(Math.round(prices.sponsored_cents / 100));
      }
    } catch (e) {
      setToast({ kind: 'error', msg: e instanceof Error ? e.message : 'Load failed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Dismiss toast after 6s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  async function apply(kind: 'verified' | 'sponsored') {
    setSubmitting(kind);
    setToast(null);
    try {
      const included = kind === 'verified' ? data?.verifiedIncluded : data?.sponsoredIncluded;
      // Plan-included: just kick off the admin-review flow.
      // Add-on (paid): subscribe via the billing endpoint, which will redirect
      // to LunarPay checkout for free-tier users with no card on file.
      if (included) {
        const res = await fetch('/api/listing/directory-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setToast({ kind: 'error', msg: j.error ?? 'Request failed' });
          return;
        }
        setToast({
          kind: 'success',
          msg: kind === 'verified'
            ? 'Verification request submitted — our team will review your listing within 1–2 business days.'
            : 'Sponsored placement request submitted — our team will be in touch shortly.',
        });
      } else {
        const res = await fetch('/api/venue-billing/addons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [kind]: true }),
        });
        const j = (await res.json().catch(() => ({}))) as
          | { kind: 'switched'; total_cents: number }
          | { kind: 'checkout_required'; url: string }
          | { error?: string };
        if (!res.ok) {
          setToast({ kind: 'error', msg: (j as { error?: string }).error ?? 'Request failed' });
          return;
        }
        if ((j as { kind?: string }).kind === 'checkout_required') {
          window.location.href = (j as { url: string }).url;
          return;
        }
        setToast({
          kind: 'success',
          msg: kind === 'verified'
            ? `Verified Listing add-on subscribed — your monthly bill includes $${verifiedPriceMonthly}/mo. Our team will review and activate the badge within 1–2 business days.`
            : `Sponsored Listing add-on subscribed — your monthly bill includes $${sponsoredPriceMonthly}/mo. Our team will review and activate placement within 1–2 business days.`,
        });
      }
      await load();
    } finally {
      setSubmitting(null);
    }
  }

  async function cancel(kind: 'verified' | 'sponsored') {
    setSubmitting(kind);
    setToast(null);
    try {
      const res = await fetch('/api/venue-billing/addons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [kind]: false }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setToast({ kind: 'error', msg: j.error ?? 'Cancel failed' });
        return;
      }
      setToast({
        kind: 'success',
        msg: `${kind === 'verified' ? 'Verified Listing' : 'Sponsored Listing'} cancelled — your monthly bill will be reduced on the next cycle.`,
      });
      await load();
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const vs = data?.directory_verified_status ?? 'none';
  const ss = data?.directory_sponsored_status ?? 'none';
  const verifiedIncluded = data?.verifiedIncluded ?? false;
  const sponsoredIncluded = data?.sponsoredIncluded ?? false;
  const verifiedSubscribed = data?.addonVerified ?? false;
  const sponsoredSubscribed = data?.addonSponsored ?? false;
  const isHighestPlan = data?.isHighestPlan ?? false;
  const isLegacyPlan = data?.isLegacyPlan ?? false;
  const planName = data?.planName;

  // The CTA is shown when no signal exists yet (no application, no subscription)
  // — or if the user was rejected and may want to retry.
  // Legacy plans have all add-ons bundled and cannot upgrade.
  const canApplyVerified = !isLegacyPlan && (vs === 'none' || vs === 'rejected') && !verifiedSubscribed;
  const canApplySponsored = !isLegacyPlan && (ss === 'none' || ss === 'rejected') && !sponsoredSubscribed;

  return (
    <div className="space-y-6 py-2">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/dashboard/listing"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft size={13} /> Back to listing
        </Link>
        <h1 className="mt-2 font-heading text-2xl text-gray-900">Verified &amp; Sponsored</h1>
        <p className="mt-1 max-w-xl text-sm text-gray-500">
          Add a blue verified badge or sponsored placement to your public listing on
          storyvenue.com. These optional add-ons are billed monthly and can be cancelled
          at any time. Pricing is subject to change — current subscribers will receive
          at least 30 days' notice before any price increase takes effect.
        </p>
      </div>

      {/* ── Plan inclusion banner ──────────────────────────────────── */}
      {isLegacyPlan ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <span className="font-semibold">Both add-ons are included in your {planName ?? 'legacy'} plan</span>
            {' '}— Verified and Sponsored placement are part of your existing arrangement
            at no extra charge. Our team will keep your badges live; no upgrade or
            subscription change is needed.
          </div>
        </div>
      ) : isHighestPlan ? (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <span className="font-semibold">Both add-ons are included in your {planName ?? 'current'} plan</span>
            {' '}— Verified and Sponsored are available to you at no extra charge.
            Apply below and our team will review within 1–2 business days.
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <Info size={16} className="mt-0.5 shrink-0 text-violet-600" />
          <div>
            Verified and Sponsored are monthly add-ons on your current plan.
            {planName && (
              <> They are included free on our highest-tier plan — upgrade
              from <strong>{planName}</strong> to get both at no extra cost.</>
            )}
            {' '}
            <Link href="/dashboard/directory-billing" className="font-semibold underline hover:text-violet-700">
              View plans
            </Link>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
            toast.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
          )}
          {toast.msg}
        </div>
      )}

      {/* ── Verified listing card ──────────────────────────────────── */}
      <div className={CARD}>
        {/* Pricing header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
              style={{ backgroundColor: '#3897F0' }}
            >
              <BadgeCheck size={22} />
            </div>
            <div>
              <h2 className="font-heading text-lg text-gray-900">Verified venue</h2>
              <p className="mt-1 text-sm text-gray-500">
                Displays a blue verified badge next to your venue name on your public
                listing and in directory search results.
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {isLegacyPlan ? (
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <Sparkles size={11} /> Included free
                </div>
                <p className="text-xs text-gray-400">
                  <span className="line-through">${verifiedPriceMonthly}/mo</span>
                  {' '}value
                </p>
              </div>
            ) : verifiedIncluded ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <Sparkles size={11} /> Included
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-900">${verifiedPriceMonthly}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                <p className="mt-0.5 text-[11px] text-gray-400">Billed monthly · cancel anytime</p>
              </>
            )}
          </div>
        </div>

        {/* What's included */}
        <div className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2 sm:px-8">
          {[
            'Blue verified badge on public listing',
            'Badge appears in directory search results',
            'Increases trust and conversion with brides',
            'Human review within 1–2 business days',
          ].map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm text-gray-700">
              <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
              {f}
            </div>
          ))}
        </div>

        {/* Status + action */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-3xl border-t border-gray-100 bg-gray-50 px-6 py-4 sm:px-8">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Current status:</span>
            <StatusPill status={vs} />
            {verifiedSubscribed && !verifiedIncluded ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Subscribed · ${verifiedPriceMonthly}/mo
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {isLegacyPlan ? (
              <p className="text-xs text-gray-500">Managed for you as part of your legacy plan.</p>
            ) : vs === 'approved' ? (
              <p className="text-xs text-gray-500">Your badge is live on the directory.</p>
            ) : vs === 'pending' || vs === 'draft' ? (
              <p className="text-xs text-gray-500">Our team is reviewing your listing.</p>
            ) : canApplyVerified ? (
              verifiedIncluded ? (
                <button
                  type="button"
                  disabled={!!submitting}
                  onClick={() => void apply('verified')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {submitting === 'verified' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <BadgeCheck size={13} />
                  )}
                  Apply for verification
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-900">${verifiedPriceMonthly}/month</p>
                    <p className="text-[11px] text-gray-400">Price may change with notice</p>
                  </div>
                  <button
                    type="button"
                    disabled={!!submitting}
                    onClick={() => void apply('verified')}
                    className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
                  >
                    {submitting === 'verified' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <BadgeCheck size={13} />
                    )}
                    Apply &amp; subscribe — ${verifiedPriceMonthly}/mo
                  </button>
                </div>
              )
            ) : null}
            {/* Cancel button if subscribed (paid add-on, not plan-included) */}
            {verifiedSubscribed && !verifiedIncluded ? (
              <button
                type="button"
                disabled={!!submitting}
                onClick={() => void cancel('verified')}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {submitting === 'verified' ? <Loader2 size={12} className="animate-spin" /> : null}
                Cancel add-on
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Sponsored listing card ─────────────────────────────────── */}
      <div className={CARD}>
        {/* Pricing header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100">
              <Megaphone size={22} className="text-amber-700" />
            </div>
            <div>
              <h2 className="font-heading text-lg text-gray-900">Sponsored listing</h2>
              <p className="mt-1 text-sm text-gray-500">
                Promoted placement in directory browse and search with a{' '}
                <span className="font-medium text-amber-700">Sponsored</span> label.
                Limited slots per market — first come, first served.
              </p>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {isLegacyPlan ? (
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <Sparkles size={11} /> Included free
                </div>
                <p className="text-xs text-gray-400">
                  <span className="line-through">${sponsoredPriceMonthly}/mo</span>
                  {' '}value
                </p>
              </div>
            ) : sponsoredIncluded ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <Sparkles size={11} /> Included
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-900">${sponsoredPriceMonthly}<span className="text-sm font-normal text-gray-500">/mo</span></p>
                <p className="mt-0.5 text-[11px] text-gray-400">Billed monthly · cancel anytime</p>
              </>
            )}
          </div>
        </div>

        {/* What's included */}
        <div className="grid grid-cols-1 gap-4 px-6 py-5 sm:grid-cols-2 sm:px-8">
          {[
            '"Sponsored" label on public listing',
            'Boosted placement in directory search',
            'Increased visibility during peak search',
            'Limited slots per metro area',
          ].map((f) => (
            <div key={f} className="flex items-center gap-2 text-sm text-gray-700">
              <CheckCircle2 size={15} className="shrink-0 text-amber-500" />
              {f}
            </div>
          ))}
        </div>

        {/* Status + action */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-3xl border-t border-gray-100 bg-gray-50 px-6 py-4 sm:px-8">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Current status:</span>
            <StatusPill status={ss} />
            {sponsoredSubscribed && !sponsoredIncluded ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                Subscribed · ${sponsoredPriceMonthly}/mo
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {isLegacyPlan ? (
              <p className="text-xs text-gray-500">Managed for you as part of your legacy plan.</p>
            ) : ss === 'approved' ? (
              <p className="text-xs text-gray-500">Your sponsored placement is live.</p>
            ) : ss === 'pending' || ss === 'draft' ? (
              <p className="text-xs text-gray-500">Our team is confirming your slot.</p>
            ) : canApplySponsored ? (
              sponsoredIncluded ? (
                <button
                  type="button"
                  disabled={!!submitting}
                  onClick={() => void apply('sponsored')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {submitting === 'sponsored' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Megaphone size={13} />
                  )}
                  Apply for sponsored placement
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-900">${sponsoredPriceMonthly}/month</p>
                    <p className="text-[11px] text-gray-400">Price may change with notice</p>
                  </div>
                  <button
                    type="button"
                    disabled={!!submitting}
                    onClick={() => void apply('sponsored')}
                    className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {submitting === 'sponsored' ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Megaphone size={13} />
                    )}
                    Apply &amp; subscribe — ${sponsoredPriceMonthly}/mo
                  </button>
                </div>
              )
            ) : null}
            {/* Cancel button if subscribed (paid add-on, not plan-included) */}
            {sponsoredSubscribed && !sponsoredIncluded ? (
              <button
                type="button"
                disabled={!!submitting}
                onClick={() => void cancel('sponsored')}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {submitting === 'sponsored' ? <Loader2 size={12} className="animate-spin" /> : null}
                Cancel add-on
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Upgrade CTA (only when on a non-highest plan; never for legacy) ─────────── */}
      {!isHighestPlan && !isLegacyPlan && (
        <div className="flex items-center justify-between gap-4 rounded-3xl bg-gray-900 px-6 py-5 sm:px-8">
          <div>
            <p className="font-heading text-base text-white">Get both included in your plan</p>
            <p className="mt-1 text-sm text-gray-400">
              Upgrade to our highest-tier plan and Verified + Sponsored are included
              at no extra charge — saving you ${verifiedPriceMonthly + sponsoredPriceMonthly}/month.
            </p>
          </div>
          <Link
            href="/dashboard/directory-billing"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
          >
            View plans <ArrowRight size={14} />
          </Link>
        </div>
      )}

      {/* ── Pricing disclaimer ─────────────────────────────────────── */}
      <p className="pb-2 text-center text-[11px] leading-relaxed text-gray-400">
        All prices are in USD and billed monthly. Pricing is subject to change at any time.
        Current subscribers will receive at least 30 days&apos; advance notice before any price
        change takes effect. Cancellation takes effect at the end of the current billing period.
        For questions contact{' '}
        <a href="mailto:hello@storyvenue.com" className="underline hover:text-gray-600">
          hello@storyvenue.com
        </a>
        .
      </p>
    </div>
  );
}
