'use client';

/**
 * Admin → Subscriptions: move venues' software billing from LunarPay to the
 * owner's Stripe account. Each row is matched to a Stripe customer by email
 * (or a customer id pasted in). "Move" creates the Stripe subscription with its
 * first charge on the date LunarPay would next have charged, then cancels
 * LunarPay — never both.
 */

import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

interface Row {
  venueId: string;
  venueName: string | null;
  lunarpay: { id: string; status: string; amountCents: number; nextPaymentOn: string | null } | null;
  customerId: string | null;
  card: { id: string; brand: string | null; last4: string | null; exp: string | null } | null;
  stripeAmountCents: number;
  amountMatches: boolean;
  addonsNotBilled: boolean;
  firstChargeDate: string | null;
  chargesNow: boolean;
  ready: boolean;
  blocker: string | null;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function LunarPayToStripePanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkIds, setLinkIds] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/billing/lunarpay-migration', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load');
      setRows(d.venues as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function preview(venueId: string) {
    setBusy(venueId);
    setError(null);
    try {
      const res = await fetch('/api/admin/billing/lunarpay-migration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, customerId: linkIds[venueId] || undefined, dryRun: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Preview failed');
      setRows((prev) => (prev ?? []).map((r) => (r.venueId === venueId ? (d.preview as Row) : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(null);
    }
  }

  async function move(r: Row) {
    const when = r.chargesNow ? 'TODAY (their LunarPay payment is overdue)' : day(r.firstChargeDate);
    if (!window.confirm(
      `Move ${r.venueName ?? 'this venue'} to Stripe?\n\n` +
      `• Stripe starts billing ${usd(r.stripeAmountCents)}/mo on ${when}\n` +
      `• Card: ${r.card?.brand ?? 'card'} •••• ${r.card?.last4 ?? '????'}\n` +
      `• Their LunarPay subscription is cancelled right after\n\n` +
      (r.addonsNotBilled ? 'Their add-ons stay unbilled, same as on LunarPay.\n\n' : '') +
      'Continue?',
    )) return;
    setBusy(r.venueId);
    setError(null);
    try {
      const res = await fetch('/api/admin/billing/lunarpay-migration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: r.venueId, customerId: linkIds[r.venueId] || r.customerId || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Move failed');
      setDone((prev) => ({ ...prev, [r.venueId]: `Moved — first Stripe charge ${day(d.firstChargeDate)}` }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-gray-700" /> Move LunarPay subscribers to Stripe
          </h3>
          <p className="mt-1 text-xs text-gray-500 max-w-2xl">
            Venues still billed on LunarPay, matched to customers in your Stripe account by email.
            Moving one starts its Stripe subscription on the date LunarPay would next have charged,
            then cancels LunarPay — no double charge, no gap. Venues with no card in Stripe get a
            banner on their billing page to add one.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {error && <p className="mx-6 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {rows === null ? (
        <div className="px-6 py-8 text-center text-sm text-gray-500">{loading ? 'Loading…' : '—'}</div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-500">Nobody is billed on LunarPay anymore. 🎉</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-2.5">Venue</th>
                <th className="px-3 py-2.5">LunarPay</th>
                <th className="px-3 py-2.5">Stripe customer / card</th>
                <th className="px-3 py-2.5">First Stripe charge</th>
                <th className="px-6 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.venueId} className="align-top">
                  <td className="px-6 py-3 font-medium text-gray-900">{r.venueName ?? r.venueId}</td>
                  <td className="px-3 py-3 text-gray-600">
                    {r.lunarpay ? (
                      <>
                        {usd(r.lunarpay.amountCents)}/mo · {r.lunarpay.status}
                        <div className="text-xs text-gray-400">next {day(r.lunarpay.nextPaymentOn)}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {r.customerId ? <span className="font-mono text-xs">{r.customerId}</span> : <span className="text-amber-700">No match</span>}
                    {r.card && <div className="text-xs text-gray-500">{r.card.brand} •••• {r.card.last4} · exp {r.card.exp}</div>}
                    <input
                      value={linkIds[r.venueId] ?? ''}
                      onChange={(e) => setLinkIds((p) => ({ ...p, [r.venueId]: e.target.value.trim() }))}
                      placeholder="Link a customer (cus_…)"
                      className="mt-1.5 w-44 rounded-md border border-gray-200 px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="px-3 py-3 text-gray-600">
                    {r.chargesNow ? <span className="text-amber-700">Today (overdue)</span> : day(r.firstChargeDate)}
                    <div className="text-xs text-gray-400">
                      {usd(r.stripeAmountCents)}/mo{!r.amountMatches && r.lunarpay ? ' · differs from LunarPay' : ''}
                      {r.addonsNotBilled && <div>plan only — add-ons weren&apos;t billed on LunarPay</div>}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-right">
                    {done[r.venueId] ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 size={14} /> {done[r.venueId]}
                      </span>
                    ) : (
                      <div className="flex flex-col items-end gap-1.5">
                        <button
                          onClick={() => void preview(r.venueId)}
                          disabled={busy !== null}
                          className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                        >
                          Check again
                        </button>
                        <button
                          onClick={() => void move(r)}
                          disabled={busy !== null || !r.ready}
                          title={r.blocker ?? undefined}
                          className="rounded-md bg-[#1b1b1b] px-2.5 py-1 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
                        >
                          {busy === r.venueId ? 'Working…' : 'Move to Stripe'}
                        </button>
                        {r.blocker && <span className="max-w-[14rem] text-right text-[11px] text-gray-500">{r.blocker}</span>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
